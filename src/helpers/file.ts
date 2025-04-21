import fs from "node:fs";
import path from "node:path";
import { getFileSize } from "./fs";

const IGNORE_SD_CARD_FOLDERS_NAMED = [
  "THMBNL", // ignore Sony thumbnail image files they keep for video
];

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".heic", ".tiff", ".webp"];
const VIDEO_EXTS = [".mp4", ".mov", ".avi", ".mkv", ".m4v", ".wmv"];

type FileInfo = {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  isVideo: boolean;
  isImage: boolean;

  volumeName: string;
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

  let totalFilesIndexed = 0;
  let totalBytesIndexed = 0;
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
          const fileId = await getFileId(fullPath);

          const fileObj: FileInfo = {
            id: fileId,
            name,
            path: fullPath,
            sizeBytes: await getFileSize(fullPath),
            isVideo: false,
            isImage: false,
            volumeName,
          };

          if (IMAGE_EXTS.includes(ext)) {
            fileObj.isVideo = false;
            fileObj.isImage = true;

            images[fileId] = fileObj;
          } else {
            fileObj.isVideo = true;
            fileObj.isImage = false;

            videos[fileId] = fileObj;
          }
          console.log("indexed", fileObj.name);

          // collect run metadata
          totalFilesIndexed += 1;
          totalBytesIndexed += fileObj.sizeBytes;
        }
      }
    }
  }

  await walk(volumeRoot);

  console.log("total files indexed", totalFilesIndexed);
  console.log("total bytes indexed", totalBytesIndexed);

  return { videos, images, volumeName, volumeRoot };
}

export async function findMissingContents({
  sdIndex,
  hdIndexes,
}: {
  sdIndex: DriveIndex;
  hdIndexes: Array<DriveIndex>;
}): Promise<{
  missing: Array<FileInfo>;
  potentiallyCorrupted: Array<FileInfo>;
}> {
  const missingFiles: Array<FileInfo> = [];
  const potentiallyCorruptFiles: Array<FileInfo> = [];

  // TODO: a bit inefficient but collect into merged object (probably want to undo the videos/images naming separation)
  const sdFilesToFind: { [key: string]: FileInfo } = {
    ...sdIndex.videos,
    ...sdIndex.images,
  };
  const allHDFiles: { [key: string]: FileInfo } = hdIndexes.reduce(
    (acc, hdIndex) => {
      return {
        // biome-ignore lint/performance/noAccumulatingSpread: combining indexes
        ...acc,
        ...hdIndex.videos,
        ...hdIndex.images,
      };
    },
    {},
  );

  for (const [fileId, sdFile] of Object.entries(sdFilesToFind)) {
    // (0) check if file exists on any drive
    const foundOnSomeHD = Object.hasOwn(allHDFiles, fileId);
    if (!foundOnSomeHD) {
      missingFiles.push(sdFile);
      continue;
    }

    // (1) ensure contents match bit-for-bit (compare full file hashes)
    const hdFile = allHDFiles[fileId];
    const sdSideHash = await getFullFileHash(sdFile.path);
    const hdSideHash = await getFullFileHash(hdFile.path);

    console.log(`≈ comparing [${sdFile.name}] (SD) to [${hdFile.name}] HD`);
    if (sdSideHash !== hdSideHash) {
      potentiallyCorruptFiles.push(sdFile);
    }
    console.log(`    ✔ match [${sdFile.name}]`, sdSideHash);
  }

  return {
    missing: missingFiles,
    potentiallyCorrupted: potentiallyCorruptFiles,
  };
}

// note: we can’t rely on SD card derived filenames because a card will reset it’s naming when formatted,
//       so we derive file identifiers by sampling regions of the file + hashing. ideally we have a more
//       clever fingerprinting strategy here, but collision odds are very low. (and the error case is
//       that we have a false positive that a file is missing or corrupt)
const SAMPLE_REGION_CHUNK_SIZE = 256 * 1024; // 256 KB per region
const TOTAL_SAMPLE_REGIONS = 10;
/*
  |---------|---------|---------|---------|---------|---------|---------|---------|---------|---------|
  ^         ^         ^         ^         ^         ^         ^         ^         ^         ^
  0%       10%       20%       30%       40%       50%       60%       70%       80%       90%
*/

export async function getFileId(
  filePath: string,
  chunkSize: number = SAMPLE_REGION_CHUNK_SIZE,
  regions: number = TOTAL_SAMPLE_REGIONS,
): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const file = Bun.file(filePath);
  const fileSize = (await file.stat()).size;

  const regionSpacing = Math.floor(fileSize / regions);

  for (let i = 0; i < regions; i++) {
    const offset = i * regionSpacing;
    const readSize = Math.min(chunkSize, fileSize - offset);
    const slice = await file.slice(offset, offset + readSize).arrayBuffer();
    hasher.update(new Uint8Array(slice));
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

export function bytesToGB(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
}
