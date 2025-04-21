import fs from "node:fs";
import path from "node:path";

const IGNORE_SD_CARD_FOLDERS_NAMED = [
	"THMBNL", // ignore Sony thumbnail image files they keep for video
];

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".heic", ".tiff", ".webp"];
const VIDEO_EXTS = [".mp4", ".mov", ".avi", ".mkv", ".m4v", ".wmv"];

// note: we can’t rely on SD card derived filenames because a card will reset it’s naming when formatted,
//       so we derive file identifiers from shallow hashes we take from the start of files. ideally we have
//       a more clever fingerprinting strategy here, but collision odds are very low. (and the error case is
//       that we have a false positive that a file is missing or corrupt)
const DEFAULT_PARTIAL_HASH_BYTES = 16 * 1024; // 16 KB

type FileInfo = {
	id: string;
	name: string;
	path: string;
	isVideo: boolean;
	isImage: boolean;
};
type DriveIndex = {
	videos: { [key: string]: FileInfo };
	images: { [key: string]: FileInfo };
	volumeName: string;
	volumeRoot: string;
};

export async function indexVolume({
	volumeRoot,
	volumeName,
}: {
	volumeRoot: string;
	volumeName: string;
}): Promise<DriveIndex> {
	const videos: { [key: string]: FileInfo } = {};
	const images: { [key: string]: FileInfo } = {};

	async function walk(currentPath: string) {
		const entries = fs.readdirSync(currentPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(currentPath, entry.name);

			if (entry.isDirectory()) {
				if (
					entry.name.startsWith(".") ||
					IGNORE_SD_CARD_FOLDERS_NAMED.includes(entry.name)
				) {
					continue; // ignore hidden directories, video thumbnail images, etc.
				}

				await walk(fullPath);
			} else if (entry.isFile()) {
				if (entry.name.startsWith(".")) {
					continue; // ignore hidden metadata files
				}

				const ext = path.extname(entry.name).toLowerCase();
				const name = entry.name;

				if ([...IMAGE_EXTS, ...VIDEO_EXTS].includes(ext)) {
					const fileObj: FileInfo = {
						id: await getFileId(fullPath),
						name,
						path: fullPath,
						isVideo: false,
						isImage: false,
					};

					if (IMAGE_EXTS.includes(ext)) {
						fileObj.isVideo = false;
						fileObj.isImage = true;
					} else {
						fileObj.isVideo = true;
						fileObj.isImage = false;
					}

					videos[name] = fileObj;
					console.log(`indexed ${name}`);
				}
			}
		}
	}

	await walk(volumeRoot);

	return { videos, images, volumeName, volumeRoot };
}

// note: this assumes the file names have not changed on the HD. if we assume they can
//       change, we’d need to hash every file on the HD (very slow) to then have an identifying
//       handle to find the sd-side file.
export async function findMissingContents({
	sdIndex,
	hdIndexes,
}: {
	sdIndex: DriveIndex;
	hdIndexes: Array<DriveIndex>;
}): Promise<{ missing: Array<FileInfo> }> {
	const missingVideos: Array<FileInfo> = [];
	const missingImages: Array<FileInfo> = [];

	// double for loops top-level here are fine (n < 5), we could combine the separate hd indexes into 1 flat thing but it’s fine.
	for (const video of Object.values(sdIndex.videos)) {
		for (const hdIndex of hdIndexes) {
			const found = Object.hasOwn(hdIndex.videos, video.name);

			if (found) {
				const sdSideHash = getFileHash(video.path);
				const hdSideHash = getFileHash(hdIndex.videos[video.name].path);

				if (sdSideHash !== hdSideHash) {
					throw new Error(
						`Hash mismatch for video ${video.name} on SD and HD. Potentially corrupt, recheck copy.`,
					);
				}
			} else {
				missingVideos.push(video);
			}
		}
	}
	for (const image of Object.values(sdIndex.images)) {
		for (const hdIndex of hdIndexes) {
			const found = Object.hasOwn(hdIndex.images, image.name);

			if (found) {
				const sdSideHash = getFileHash(image.path);
				const hdSideHash = getFileHash(hdIndex.images[image.name].path);

				if (sdSideHash !== hdSideHash) {
					throw new Error(
						`Hash mismatch for image ${image.name} on SD and HD. Potentially corrupt, recheck copy.`,
					);
				}
			} else {
				missingImages.push(image);
			}
		}
	}

	return {
		missing: [...missingVideos, ...missingImages],
	};
}

export async function getFileId(
	filePath: string,
	maxBytes: number = DEFAULT_PARTIAL_HASH_BYTES,
): Promise<string> {
	const hasher = new Bun.CryptoHasher("sha256");
	const stream = Bun.file(filePath).stream();
	const reader = stream.getReader();

	let totalRead = 0;
	while (totalRead < maxBytes) {
		const { done, value } = await reader.read();
		if (done || !value) break;

		const remaining = maxBytes - totalRead;
		const chunk =
			value.byteLength > remaining ? value.subarray(0, remaining) : value;

		hasher.update(chunk);
		totalRead += chunk.byteLength;

		if (chunk.byteLength < value.byteLength) break; // we only needed a slice of this chunk
	}

	return hasher.digest("hex");
}

export async function getFullFileHash(filePath: string): Promise<string> {
	const hasher = new Bun.CryptoHasher("sha256");
	const stream = Bun.file(filePath).stream();
	const reader = stream.getReader();

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) hasher.update(value);
	}

	return hasher.digest("hex");
}
