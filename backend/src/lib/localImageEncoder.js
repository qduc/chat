import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getImageMetadata } from './images/metadataStore.js';

const DEFAULT_STORAGE_PATH = process.env.IMAGE_STORAGE_PATH || './data/images';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const MIME_BY_EXT = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif',
};

function getMimeType(filename) {
	const ext = path.extname(filename).toLowerCase().replace('.', '');
	return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function isLocalImageUrl(url) {
	if (typeof url !== 'string' || url.startsWith('data:')) {
		return false;
	}

	try {
		const parsed = new URL(url, 'http://localhost');
		const hostname = parsed.hostname || 'localhost';
		if (!LOCAL_HOSTNAMES.has(hostname)) {
			return false;
		}
		if (!parsed.pathname || !parsed.pathname.startsWith('/v1/images/')) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

function resolveImageId(url) {
	try {
		const parsed = new URL(url, 'http://localhost');
		const filename = path.basename(parsed.pathname);
		if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
			return null;
		}
		return filename;
	} catch {
		return null;
	}
}

export function maybeConvertLocalImageUrl(imageUrl) {
	if (!isLocalImageUrl(imageUrl)) {
		return imageUrl;
	}

	const imageId = resolveImageId(imageUrl);
	if (!imageId) {
		return imageUrl;
	}

	const metadata = getImageMetadata(imageId);
	if (!metadata || !metadata.storageFilename) {
		return imageUrl;
	}

	const storagePath = path.resolve(DEFAULT_STORAGE_PATH);
	const filePath = path.join(storagePath, metadata.storageFilename);

	if (!existsSync(filePath)) {
		return imageUrl;
	}

	try {
		const buffer = readFileSync(filePath);
		const mime = metadata.mimeType || getMimeType(metadata.storageFilename);
		return `data:${mime};base64,${buffer.toString('base64')}`;
	} catch {
		return imageUrl;
	}
}

export function convertContentPartImage(part) {
	if (!part || typeof part !== 'object') {
		return part;
	}

	if (part.type !== 'image_url') {
		return part;
	}

	if (typeof part.image_url === 'string') {
		const encoded = maybeConvertLocalImageUrl(part.image_url);
		if (encoded !== part.image_url) {
			return { ...part, image_url: encoded };
		}
		return part;
	}

	if (part.image_url && typeof part.image_url === 'object') {
		const url = part.image_url.url;
		const encoded = maybeConvertLocalImageUrl(url);
		if (encoded !== url) {
			return {
				...part,
				image_url: {
					...part.image_url,
					url: encoded,
				},
			};
		}
	}

	return part;
}
