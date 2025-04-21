import chalk from "chalk";
import type { Command } from "commander";
import inquirer from "inquirer";
import { findMissingContents, indexVolume } from "../helpers/file";
import { listVolumes } from "../helpers/fs";

export async function registerCheck(program: Command) {
	program
		.description(
			"Verify that all files from an SD card exist on one or more hard drives connected to your computer.",
		)
		.action(_check);
}

async function _check() {
	console.clear();

	// (0) get volumes to check
	const volumes = await getVolumes();

	// (1) index sd
	const sdIndex = await indexVolume({
		volumeName: volumes.sd.name,
		volumeRoot: volumes.sd.path,
	});

	// (2) index each hd
	const hdIndexes = await Promise.all(
		volumes.hds.map((hd) =>
			indexVolume({
				volumeName: hd.name,
				volumeRoot: hd.path,
			}),
		),
	);

	// (3) find missing contents
	const { missing } = await findMissingContents({ sdIndex, hdIndexes });
	console.log(missing);
}

async function getVolumes(): Promise<{
	sd: { name: string; path: string };
	hds: Array<{ name: string; path: string }>;
}> {
	const volumes = await listVolumes();

	// (0) select sd card
	const { sdCard } = await inquirer.prompt([
		{
			type: "list",
			name: "sdCard",
			message: "Which is your SD card?",
			choices: volumes.map(({ name, path }) => ({
				name,
				value: { name, path },
			})),
		},
	]);

	// (1) select hard drives
	// @ts-ignore
	const { hardDrives } = await inquirer.prompt([
		{
			type: "checkbox",
			name: "hardDrives",
			message: `Which are your hard drives? ${chalk.gray("(you can select multiple)")}`,
			choices: volumes
				.filter((v) => v.path !== sdCard.path)
				.map(({ name, path }) => ({
					name,
					value: { name, path },
				})),
			validate: (input) => {
				if (input.length === 0) {
					return "Please select at least one hard drive.";
				}
				return true;
			},
		},
	]);

	return {
		sd: sdCard,
		hds: hardDrives,
	};
}
