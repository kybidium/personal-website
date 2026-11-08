// Encrypts a markdown note for /admin. Run with `npm run encrypt -- path/to/note.md`.
// Keep the plaintext note outside this repo — only the ciphertext gets committed.
// Output matches src/pages/admin/index.astro: base64(salt(16) | iv(12) | ciphertext | tag(16)),
// AES-256-GCM with a PBKDF2-SHA256 key (300k iterations).
import { readFile, writeFile, access } from "node:fs/promises";
import { basename } from "node:path";
import { webcrypto as crypto } from "node:crypto";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";

const ITERATIONS = 300_000;
const OUT_DIR = new URL("./src/data/admin/", import.meta.url).pathname;

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("run this in a terminal so the passphrase stays hidden"));
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let input = "";
    const onData = (buf) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(input);
        }
        if (ch === "\u0003") process.exit(130); // Ctrl-C
        if (ch === "\u007f") input = input.slice(0, -1); // Backspace
        else input += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function encrypt(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  // Web Crypto appends the 16-byte GCM tag to the ciphertext.
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  const blob = new Uint8Array(salt.length + iv.length + body.length);
  blob.set(salt, 0);
  blob.set(iv, salt.length);
  blob.set(body, salt.length + iv.length);
  return Buffer.from(blob).toString("base64");
}

const src = process.argv[2];
if (!src || !src.endsWith(".md")) {
  console.error("usage: npm run encrypt -- path/to/note.md");
  process.exit(1);
}

// "2026-11-08-my-note.md" keeps its date; "my-note.md" gets today's.
const name = basename(src, ".md");
const dated = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(name);
const slug = dated ? name : `${new Date().toISOString().slice(0, 10)}-${name}`;
if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error(`bad file name "${name}": use lowercase letters, digits and dashes, e.g. my-note.md`);
  process.exit(1);
}
const out = `${OUT_DIR}${slug}.txt`;
if (await access(out).then(() => true, () => false)) {
  console.error(`${out} already exists; rename the note or delete the old file first`);
  process.exit(1);
}

const { code: html } = await (await createMarkdownProcessor()).render(await readFile(src, "utf8"));

const password = await askHidden("Passphrase: ");
if (password.length < 12) {
  console.error("use at least 12 characters");
  process.exit(1);
}
if ((await askHidden("Again: ")) !== password) {
  console.error("passphrases don't match");
  process.exit(1);
}

await writeFile(out, (await encrypt(html, password)) + "\n");
console.log(`wrote ${out}`);
