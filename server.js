import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { parseFile } from 'music-metadata';

const app = express();
const port = 3000;

const MP3_PATH = '/mnt/i/Audio/mp3/Music/';

app.use(cors());

app.get('/', (req, res) => {
	res.send('Audio Server v1.0');
});

// serve static mp3 files
app.use('/api/mp3', express.static(MP3_PATH));

app.get('/api/browse/*', (req, res) => {
	const formats = ['.mp3', '.m4a'];
	const path = decodeURIComponent(req.params[0]);
	const list = fs.readdirSync(MP3_PATH + path);
	let result = {
		path: req.params[0],
		folders: [],
		files: [],
		unsupported: []
	}

	list.forEach((item) => {
		const extension = item.substring(item.length - 4);

		if (extension.lastIndexOf('.') === 0) {
			if (formats.includes(extension)) {
				result.files.push(item);

			} else {
				result.unsupported.push(item);
			}

		} else {
			result.folders.push(item);
		}
	});

	// if browsing an album folder, return a subset of metadata based on the first file
	if (result.files.length > 0) {
		(async () => {
			const meta = await getMeta(result.path +'/'+ result.files[0]);

			if (meta.status === 'ok') {
				const albumMeta = {
					artist: meta.artist,
					album: meta.album,
					year: meta.year,
					image: meta.image
				};

				result.meta = albumMeta;
			}

			res.json(result);
		})();

	} else {
		res.json(result);
	}

});

// expects a path to an mp3 file
app.get('/api/meta/*', (req, res) => {
	const path = decodeURIComponent(req.params[0]);
	const host = req.header('Host');

	(async () => {
		const meta = await getMeta(path);
		meta.mp3 = `https://${host}/api/mp3/`+ encodeURIComponent(path);

		if (meta.status === 'ok') {
			res.json(meta);

		} else {
			res.status(500).json(meta);
		}
	})();
});

app.listen(port, () => {
	console.log(`Audio Server listening on port ${port}`);
	console.log(`MP3 path ${MP3_PATH}`);
});


const getMeta = async (path) => {
	try {
		let { common } = await parseFile(MP3_PATH + path);

		if (common.picture && common.picture[0]) {
			const picture = common.picture[0];

			common.image = `data:${picture.format};base64,${picture.data.toString('base64')}`;
			delete common.picture;
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