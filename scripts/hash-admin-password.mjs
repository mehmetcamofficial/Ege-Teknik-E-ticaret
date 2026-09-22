import { randomBytes, scrypt as callback } from "node:crypto";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
const prompt=createInterface({input:process.stdin,output:process.stderr,terminal:true});
const password=await prompt.question("Admin password (hidden input is not supported; run locally): ");await prompt.close();
if(password.length<12)throw new Error("Password must contain at least 12 characters.");
const salt=randomBytes(16).toString("hex"),derived=await promisify(callback)(password,salt,64);
process.stdout.write(`scrypt$${salt}$${Buffer.from(derived).toString("hex")}\n`);
