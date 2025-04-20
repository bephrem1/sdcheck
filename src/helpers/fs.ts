import fs from "node:fs";
import path from "node:path";

const VOLUMES_PATH = "/Volumes";
const IGNORE_VOLUMES_NAMED = [
	"Macintosh HD", // skip internal disk on macOS
];

export async function listVolumes(): Promise<{ name: string; path: string }[]> {
	return fs
		.readdirSync(VOLUMES_PATH)
		.filter((name) => !IGNORE_VOLUMES_NAMED.includes(name))
		.map((name) => ({ name, path: path.join(VOLUMES_PATH, name) }));
}
