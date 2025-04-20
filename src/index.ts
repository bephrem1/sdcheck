import { Command } from "commander";
import { registerCheck } from "./lib/check";

const program = new Command();

registerCheck(program);

program.parseAsync();
