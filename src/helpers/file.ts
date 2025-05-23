import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import ora from "ora";
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
  let totalVideosIndexed = 0;
  let totalImagesIndexed = 0;
  let currentFile = "";

  // progress spinner
  const spinner = ora({
    text: `Connecting to ${volumeName}...`,
    color: "white",
  }).start();

  // start timer
  const startTime = Date.now();

  // live indicator formatting + update
  const formatElapsedTime = () => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  };
  const updateProgress = () => {
    const totalGB = bytesToGB(totalBytesIndexed).toFixed(2);
    spinner.text = `Scanning ${volumeName} ${chalk.gray(`(${formatElapsedTime()})`)}: ${chalk.yellow(currentFile)} ${chalk.gray("┊")} ${totalFilesIndexed} files ${chalk.gray(`(${totalGB} GB)`)}`;
  };

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
          // Update current file being processed
          currentFile = name;
          updateProgress();

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
            totalImagesIndexed += 1;
          } else {
            fileObj.isVideo = true;
            fileObj.isImage = false;

            videos[fileId] = fileObj;
            totalVideosIndexed += 1;
          }

          // collect run metadata
          totalFilesIndexed += 1;
          totalBytesIndexed += fileObj.sizeBytes;

          // Update progress display
          updateProgress();
        }
      }
    }
  }

  await walk(volumeRoot);

  // Final update with complete information
  const totalGB = bytesToGB(totalBytesIndexed).toFixed(2);
  const elapsedTime = formatElapsedTime();

  spinner.succeed(
    `Scanned ${volumeName} ${chalk.gray(`(in ${elapsedTime})`)} ┊ ${totalFilesIndexed} files, ${totalGB} GB (${totalVideosIndexed} videos, ${totalImagesIndexed} images)`,
  );

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

  // progress spinner
  const spinner = ora({
    text: "Checking for missing files...",
    color: "white",
  }).start();

  // start timer
  const startTime = Date.now();

  let filesChecked = 0;
  let totalFiles = Object.keys(sdFilesToFind).length;
  let currentFile = "";
  let lastMatchStatus = "";

  // live indicator formatting + update
  const formatElapsedTime = () => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  };
  const updateProgress = () => {
    const percentage = Math.floor((filesChecked / totalFiles) * 100);
    let statusIndicator = "";

    if (lastMatchStatus === "matching") {
      statusIndicator = chalk.yellow("⟳ Comparing");
    } else if (lastMatchStatus === "matched") {
      statusIndicator = chalk.green("✓ Matched");
    } else if (lastMatchStatus === "missing") {
      statusIndicator = chalk.red("✗ Missing");
    } else if (lastMatchStatus === "corrupted") {
      statusIndicator = chalk.red("⚠ Corrupted");
    }

    spinner.text = `Checking files ${chalk.gray(`(${formatElapsedTime()})`)}: ${statusIndicator} ${chalk.yellow(currentFile)} ${chalk.gray("┊")} ${filesChecked}/${totalFiles} files ${chalk.gray(`(${percentage}%)`)}`;
  };

  for (const [fileId, sdFile] of Object.entries(sdFilesToFind)) {
    // update progress
    currentFile = sdFile.name;
    filesChecked += 1;
    lastMatchStatus = "matching";
    updateProgress();

    // (0) check if file exists on any drive
    const foundOnSomeHD = Object.hasOwn(allHDFiles, fileId);
    if (!foundOnSomeHD) {
      lastMatchStatus = "missing";
      updateProgress();
      missingFiles.push(sdFile);

      await new Promise((resolve) => setTimeout(resolve, 100)); // brief pause to show the missing status
      continue;
    }

    // (1) ensure contents match bit-for-bit (compare full file hashes)
    const hdFile = allHDFiles[fileId];
    const sdSideHash = await getFullFileHash(sdFile.path);
    const hdSideHash = await getFullFileHash(hdFile.path);

    if (sdSideHash !== hdSideHash) {
      lastMatchStatus = "corrupted";
      updateProgress();
      potentiallyCorruptFiles.push(sdFile);

      // brief pause to show the corrupted status
      await new Promise((resolve) => setTimeout(resolve, 100));
    } else {
      // Show success with green indicator
      lastMatchStatus = "matched";
      updateProgress();

      // brief flash of green success
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  // final update
  const elapsedTime = formatElapsedTime();
  spinner.succeed(
    `Checked ${totalFiles} files ${chalk.gray(`(in ${elapsedTime})`)} ┊ ${missingFiles.length} missing, ${potentiallyCorruptFiles.length} potentially corrupted`,
  );

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
