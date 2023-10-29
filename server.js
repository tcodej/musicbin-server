import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import mcache from 'memory-cache';
import { parseFile } from 'music-metadata';

const app = express();
const ttl = 300;	// 5 minutes

dotenv.config();

const cache = (duration) => {
	return (req, res, next) => {
		const key = 'music-server' + req.originalUrl || req.url;
		const cachedBody = mcache.get(key);

		if (cachedBody) {
			res.send(cachedBody);
			return;

		} else {
			res.sendResponse = res.send;
			res.send = (body) => {
				mcache.put(key, body, duration * 1000);
				res.sendResponse(body);
			}

			next();
		}
	}
}

app.use(cors({
	origin: process.env.CORS_ORIGINS.split(',')
}));

app.get('/', (req, res) => {
	res.send('Music Server v1.0');
});

// serve static mp3 files - required
app.use('/api/mp3', express.static(process.env.MP3_PATH));

// also serve cdg files for yokie - optional
if (process.env.CDG_PATH) {
	app.use('/api/cdg', express.static(process.env.CDG_PATH));
}

app.get('/api/browse/*', cache(ttl), (req, res) => {
	const pathReq = decodeURIComponent(req.params[0]);
	const list = fs.readdirSync(process.env.MP3_PATH + pathReq);
	let result = {
		path: req.params[0],
		folders: [],
		files: [],
		unsupported: []
	}

	list.forEach((item) => {
		if (isFolder(item)) {
			result.folders.push(item);

		} else {
			if (isMusicFile(item)) {
				result.files.push(item);

			} else {
				result.unsupported.push(item);
			}
		}
	});

	// if browsing an album folder, return a subset of metadata based on the first file
	if (result.files.length > 0) {
		(async () => {
			const meta = await getMeta(result.path +'/'+ result.files[0], true);

			if (meta.status === 'ok') {
				result.meta = meta;
			}

			res.json(result);
		})();

	} else {
		res.json(result);
	}
});

// expects a path to an mp3 file
app.get('/api/meta/folder/*', cache(ttl), (req, res) => {
	const pathReq = decodeURIComponent(req.params[0]);
	const list = fs.readdirSync(process.env.MP3_PATH + pathReq);

	if (isMusicFile(list[0])) {
		(async () => {
			const meta = await getMeta(pathReq +'/'+ list[0], true);

			if (meta.status === 'ok') {
				res.json(meta);

			} else {
				res.status(500).json(meta);
			}
		})();

	} else {
		res.json({});
	}
});

// expects a path to an mp3 file
app.get('/api/meta/*', cache(ttl), (req, res) => {
	const pathReq = decodeURIComponent(req.params[0]);
	const host = req.header('Host');

	(async () => {
		const meta = await getMeta(pathReq);
		meta.mp3 = `${process.env.PROTOCOL}://${host}/api/mp3/`+ encodeURIComponent(pathReq);

		if (meta.status === 'ok') {
			res.json(meta);

		} else {
			res.status(500).json(meta);
		}
	})();
});

app.listen(process.env.PORT, () => {
	console.log(`Music Server running ${process.env.PROTOCOL}://localhost:${process.env.PORT}`);
	console.log(`MP3 path ${process.env.MP3_PATH}`);
});

const getMeta = async (pathReq, subset) => {
	try {
		let { common } = await parseFile(process.env.MP3_PATH + pathReq);

		if (common.picture && common.picture[0]) {
			const picture = common.picture[0];

			common.image = `data:${picture.format};base64,${picture.data.toString('base64')}`;
			delete common.picture;
		}

		if (subset === true) {
			const albumMeta = {
				artist: common.artist,
				album: common.album,
				year: common.year,
				image: common.image
			};

			common = albumMeta;
		}

		common.status = 'ok';
		return common;

	} catch (err) {
		console.log(err);
		return {
			stauts: 'error',
			message: err.message
		};
	}
}

const isFolder = (str) => {
	return isMusicFile(str) ? false : true;
};

const isMusicFile = (str) => {
	const formats = ['.mp3', '.m4a'];
	const extension = path.extname(str);

	return extension && formats.includes(extension) ? true : false;
};