import { Command } from "commander";
import { registerCheck } from "./lib/check";
import { registerDev } from "./lib/dev";

const program = new Command();

registerCheck(program);
registerDev(program);

program.parseAsync();
