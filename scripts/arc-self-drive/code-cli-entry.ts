import { Command } from "commander";
import { registerCodeCli } from "../../src/cli/code-cli.js";

const program = new Command();
program.name("openclaw");
registerCodeCli(program);

await program.parseAsync(["code", ...process.argv.slice(2)], {
  from: "user",
});
