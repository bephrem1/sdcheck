import fs from "node:fs";
import path from "node:path";

const IGNORE_SD_CARD_FOLDERS_NAMED = [
	"THMBNL", // ignore Sony thumbnail image files they keep for video
];

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".heic", ".tiff", ".webp"];
const VIDEO_EXTS = [".mp4", ".mov", ".avi", ".mkv", ".m4v", ".wmv"];

type FileInfo = { name: string; path: string; hash?: string | null };

export async function indexVolume(
	root: string,
	{ computeHashes = true }: { computeHashes?: boolean },
): Promise<{
	videos: Array<FileInfo>;
	images: Array<FileInfo>;
}> {
	const videos: Array<FileInfo> = [];
	const images: Array<FileInfo> = [];

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
				const ext = path.extname(entry.name).toLowerCase();
				const name = entry.name;

				if ([...IMAGE_EXTS, ...VIDEO_EXTS].includes(ext)) {
					const fileObj: FileInfo = { name, path: fullPath };
					if (computeHashes) {
						const hash = await getFileHash(fullPath);
						fileObj.hash = hash;
					}

					if (IMAGE_EXTS.includes(ext)) {
						images.push(fileObj);
					} else {
						videos.push(fileObj);
					}
				}
			}
		}
	}

	await walk(root);

	return { videos, images };
}

export async function getFileHash(filePath: string): Promise<string> {
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
