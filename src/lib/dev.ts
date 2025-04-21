import type { Command } from "commander";
import { getFileId, getFullFileHash, indexVolume } from "../helpers/file";

export async function registerDev(program: Command) {
	program.command("dev").action(async () => {
		// console.log(
		// 	await indexVolume({
		// 		volumeRoot: "/Volumes/Untitled",
		// 		volumeName: "Untitled",
		// 	}),
		// );
		console.log(
			await indexVolume({
				volumeRoot: "/Volumes/Toshiba 4TB",
				volumeName: "Untitled",
			}),
		);
	});
}
