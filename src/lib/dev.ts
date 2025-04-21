import type { Command } from "commander";
import {
  findMissingContents,
  getFileId,
  getFullFileHash,
  indexVolume,
} from "../helpers/file";

export async function registerDev(program: Command) {
  program.command("dev").action(async () => {
    console.log(
      await findMissingContents({
        sdIndex: {
          volumeRoot: "/Volumes/Untitled",
          volumeName: "SD Card",
          videos: {
            "255c94e636785b9f089348c678b72b980522b1658f319a7d3c7b7fb6e519d063":
              {
                id: "255c94e636785b9f089348c678b72b980522b1658f319a7d3c7b7fb6e519d063",
                name: "C4563.MP4",
                path: "/Volumes/Untitled/private/M4ROOT/CLIP/C4563.MP4",
                sizeBytes: 100, // dummy value
                isVideo: true,
                isImage: false,
              },
          },
          images: {},
        },
        hdIndexes: [
          {
            volumeRoot: "/Volumes/Toshiba 4TB",
            volumeName: "HD",
            videos: {
              "255c94e636785b9f089348c678b72b980522b1658f319a7d3c7b7fb6e519d063":
                {
                  id: "255c94e636785b9f089348c678b72b980522b1658f319a7d3c7b7fb6e519d063",
                  name: "C4563.MP4",
                  path: "/Volumes/Toshiba 4TB/2025/apr/lighthouse/footage/office broll 4.16.25/C4563.MP4",
                  sizeBytes: 100, // dummy value
                  isVideo: true,
                  isImage: false,
                },
            },
            images: {},
          },
        ],
      }),
    );
  });

  program.command("dev2").action(async () => {
    await indexVolume({
      volumeName: "HD",
      volumeRoot: "/Volumes/Toshiba 4TB",
    });
  });
}
