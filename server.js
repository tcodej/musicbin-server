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

const { MP3_PATH, CDG_PATH, CORS_ORIGINS, PROTOCOL, PORT } = process.env;

const cache = (duration) => {
	return (req, res, next) => {
		const key = 'music-server-' + req.originalUrl || req.url;
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
	origin: CORS_ORIGINS.split(',')
}));

app.get('/', (req, res) => {
	res.send('Music Server v1.0');
});

// serve static mp3 files - required
app.use('/api/mp3', express.static(MP3_PATH));

// also serve cdg files for yokie - optional
if (CDG_PATH) {
	app.use('/api/cdg', express.static(CDG_PATH));
}

app.get('/api/browse/*', (req, res) => {
	const pathReq = decodeURIComponent(req.params[0]);

	try {
		const list = fs.readdirSync(MP3_PATH + pathReq);
		let result = {
			path: req.params[0],
			folders: [],
			files: [],
			unsupported: []
		}

		list.forEach((item) => {
			if (isFolder(MP3_PATH + pathReq +'/'+ item)) {
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

				if (meta.ok) {
					result.meta = meta;
				}

				res.json(result);
			})();

		} else {
			// no files exist
			res.json(result);
		}

	} catch (err) {
		console.log(err);
		res.status(404).json({
			ok: false,
			error: err.message
		});
	}
});

// expects a path to folder containing at least 1 mp3 file
app.get('/api/meta/folder/*', cache(ttl), (req, res) => {
	const pathReq = decodeURIComponent(req.params[0]);

	try {
		const list = fs.readdirSync(MP3_PATH + pathReq);
		let found = false;

		// look for the first valid music file to grab meta data from
		for (let i=0; i<list.length; i++) {
			if (isMusicFile(list[i])) {
				(async () => {
					const meta = await getMeta(pathReq +'/'+ list[i], true);

					if (meta.ok) {
						res.json(meta);

					} else {
						res.status(500).json(meta);
					}
				})();

				found = true;
				break;
			}
		}

		if (found === false) {
			res.status(500).json({
				ok: false,
				error: 'Folder does not contain a valid music file'
			});
		}

	} catch(err) {
		console.log(err);
		res.status(500).json({
			ok: false,
			error: err.message
		});
	}
});

// expects a path to an mp3 file
app.get('/api/meta/*', cache(ttl), (req, res) => {
	const pathReq = decodeURIComponent(req.params[0]);
	const host = req.header('Host');

	(async () => {
		const meta = await getMeta(pathReq);
		meta.mp3 = `${PROTOCOL}://${host}/api/mp3/`+ encodeURIComponent(pathReq);

		if (meta.ok) {
			res.json(meta);

		} else {
			res.status(500).json(meta);
		}
	})();
});

app.listen(PORT, () => {
	console.log(`Music Server running at ${PROTOCOL}://localhost:${PORT}`);
	console.log(`MP3_PATH is ${MP3_PATH}`);
});

const getMeta = async (pathReq, subset) => {
	try {
		let { common } = await parseFile(MP3_PATH + pathReq);

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
				image: common.image,
				genre: common.genre
			};

			common = albumMeta;
		}

		common.ok = true;
		return common;

	} catch (err) {
		console.log(err);
		return {
			ok: false,
			error: err.message
		};
	}
}

// requires a fully qualified path
const isFolder = (path) => {
	const stats = fs.lstatSync(path);

	return stats.isDirectory() ? true : false;
};

const isMusicFile = (str) => {
	const formats = ['.mp3', '.m4a'];
	const extension = path.extname(str);

	return extension && formats.includes(extension) ? true : false;
};