// Local-only blog editor. Run with `npm run edit`, open http://localhost:4444.
// Writes markdown files in src/content/blog/ — the Astro dev server picks up
// changes instantly, so localhost:4321 is the live preview.
//
// Private notes (/admin) are encrypted in the browser tab before they reach this
// server, so only ciphertext is ever written to src/data/admin/. The passphrase
// lives in the tab's memory and is never sent here.
import { createServer } from "node:http";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";

const PORT = Number(process.env.PORT ?? 4444);
const BLOG_DIR = new URL("./src/content/blog/", import.meta.url).pathname;
const NOTES_DIR = new URL("./src/data/admin/", import.meta.url).pathname;
const markdown = await createMarkdownProcessor();
const ROOT = new URL(".", import.meta.url).pathname;
const run = promisify(execFile);
const git = (...args) => run("git", args, { cwd: ROOT });

function slugOf(url) {
  const slug = decodeURIComponent(url.split("/api/posts/")[1] ?? "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad slug: ${slug}`);
  return slug;
}

function noteSlugOf(url) {
  const slug = decodeURIComponent(url.split("/api/notes/")[1] ?? "");
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad note slug: ${slug}`);
  return slug;
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function body(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data;
}

const json = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

const server = createServer(async (req, res) => {
  try {
    if (req.url === "/" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
    } else if (req.url === "/api/posts" && req.method === "GET") {
      const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith(".md"));
      json(res, 200, files.map((f) => f.replace(/\.md$/, "")).sort());
    } else if (req.url === "/api/posts" && req.method === "POST") {
      const { title } = JSON.parse(await body(req));
      const slug = slugify(title);
      if (!slug) return json(res, 400, { error: "empty title" });
      const date = new Date().toISOString().slice(0, 10);
      const content = `---\ntitle: "${title.replace(/"/g, '\\"')}"\ndescription: ""\ndate: ${date}\ndraft: true\n---\n\nWrite here...\n`;
      await writeFile(join(BLOG_DIR, slug + ".md"), content, { flag: "wx" });
      json(res, 201, { slug });
    } else if (req.url?.startsWith("/api/posts/") && req.method === "GET") {
      const content = await readFile(join(BLOG_DIR, slugOf(req.url) + ".md"), "utf8");
      json(res, 200, { content });
    } else if (req.url?.startsWith("/api/posts/") && req.method === "PUT") {
      const { content } = JSON.parse(await body(req));
      await writeFile(join(BLOG_DIR, slugOf(req.url) + ".md"), content);
      json(res, 200, { ok: true });
    } else if (req.url === "/api/notes" && req.method === "GET") {
      const files = (await readdir(NOTES_DIR)).filter((f) => f.endsWith(".txt"));
      json(res, 200, files.map((f) => f.replace(/\.txt$/, "")).sort().reverse());
    } else if (req.url === "/api/notes" && req.method === "POST") {
      const { title } = JSON.parse(await body(req));
      const name = slugify(title);
      if (!name) return json(res, 400, { error: "empty title" });
      const slug = `${new Date().toISOString().slice(0, 10)}-${name}`;
      const taken = await readFile(join(NOTES_DIR, slug + ".txt")).then(() => true, () => false);
      if (taken) return json(res, 409, { error: `${slug} already exists` });
      json(res, 201, { slug });
    } else if (req.url?.startsWith("/api/notes/") && req.method === "GET") {
      const blob = await readFile(join(NOTES_DIR, noteSlugOf(req.url) + ".txt"), "utf8");
      json(res, 200, { blob: blob.trim() });
    } else if (req.url?.startsWith("/api/notes/") && req.method === "PUT") {
      const { blob } = JSON.parse(await body(req));
      // salt(16) + iv(12) + tag(16) at minimum; anything else means the browser sent plaintext.
      if (!/^[A-Za-z0-9+/]+=*$/.test(blob) || Buffer.from(blob, "base64").length < 44) {
        return json(res, 400, { error: "not ciphertext" });
      }
      await writeFile(join(NOTES_DIR, noteSlugOf(req.url) + ".txt"), blob + "\n");
      json(res, 200, { ok: true });
    } else if (req.url?.startsWith("/api/notes/") && req.method === "DELETE") {
      await unlink(join(NOTES_DIR, noteSlugOf(req.url) + ".txt"));
      json(res, 200, { ok: true });
    } else if (req.url === "/api/render" && req.method === "POST") {
      const { markdown: md } = JSON.parse(await body(req));
      json(res, 200, { html: (await markdown.render(md)).code });
    } else if (req.url === "/api/publish" && req.method === "POST") {
      await git("add", "src/content/blog", "src/data/admin");
      const staged = (await git("diff", "--cached", "--name-only")).stdout.trim();
      if (!staged) return json(res, 200, { published: false, message: "Nothing new to publish" });
      await git("commit", "-m", "Update blog posts");
      await git("push");
      json(res, 200, { published: true, files: staged.split("\n") });
    } else if (req.url?.startsWith("/api/posts/") && req.method === "DELETE") {
      await unlink(join(BLOG_DIR, slugOf(req.url) + ".md"));
      json(res, 200, { ok: true });
    } else {
      json(res, 404, { error: "not found" });
    }
  } catch (err) {
    json(res, err.code === "ENOENT" ? 404 : 500, { error: String(err.message ?? err) });
  }
});

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>🌿 Editor · Luis Ojeda</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✏️</text></svg>" />
<style>
  :root {
    --bg: #f5f4ec; --bg-raised: #fbfaf5; --ink: #232d1f; --ink-soft: #5c6653;
    --green: #35682d; --green-deep: #274d21; --green-tint: #e3ead9; --line: #d8dcc9;
  }
  * { margin: 0; box-sizing: border-box; }
  [hidden] { display: none !important; }
  body {
    font-family: system-ui, sans-serif; background: var(--bg); color: var(--ink);
    height: 100vh; display: flex; flex-direction: column;
  }
  header {
    padding: 0.7rem 1.25rem; border-bottom: 1px solid var(--line);
    display: flex; align-items: center; gap: 1rem; background: var(--bg-raised);
  }
  header h1 { font-size: 1rem; color: var(--green-deep); }
  header .status { font-size: 0.85rem; color: var(--ink-soft); margin-left: auto; }
  header a { color: var(--green); font-size: 0.85rem; }
  .wrap { flex: 1; display: flex; min-height: 0; }
  aside {
    width: 240px; border-right: 1px solid var(--line); background: var(--bg-raised);
    display: flex; flex-direction: column; padding: 1rem 0.75rem; gap: 0.75rem;
  }
  .newpost { display: flex; gap: 0.4rem; }
  .newpost input {
    flex: 1; min-width: 0; padding: 0.4rem 0.6rem; border: 1px solid var(--line);
    border-radius: 0.4rem; background: white; font-size: 0.85rem;
  }
  button {
    font-size: 0.85rem; padding: 0.4rem 0.8rem; border-radius: 0.4rem;
    border: 1px solid var(--green); background: var(--green); color: white; cursor: pointer;
  }
  button.ghost { background: transparent; color: var(--green); }
  button.danger { border-color: #a33; background: transparent; color: #a33; }
  button:disabled { opacity: 0.5; cursor: default; }
  ul { list-style: none; overflow-y: auto; }
  ul button {
    width: 100%; text-align: left; background: transparent; border: none;
    color: var(--ink); padding: 0.45rem 0.6rem; border-radius: 0.4rem; font-size: 0.9rem;
  }
  ul button:hover { background: var(--green-tint); }
  ul button.active { background: var(--green-tint); color: var(--green-deep); font-weight: 600; }
  main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .toolbar {
    padding: 0.5rem 1rem; display: flex; gap: 0.5rem; align-items: center;
    border-bottom: 1px solid var(--line);
  }
  .toolbar .slug { font-family: monospace; font-size: 0.85rem; color: var(--ink-soft); margin-right: auto; }
  textarea {
    flex: 1; border: none; outline: none; resize: none; padding: 1.25rem 1.5rem;
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.95rem;
    line-height: 1.6; background: var(--bg); color: var(--ink);
  }
  .empty { flex: 1; display: grid; place-items: center; color: var(--ink-soft); }
  aside h2 {
    font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--ink-soft); margin-top: 0.75rem; padding: 0 0.2rem;
  }
  .hint { font-size: 0.78rem; color: var(--ink-soft); padding: 0 0.2rem; }
  ul button.locked { color: var(--ink-soft); }
</style>
</head>
<body>
<header>
  <h1>🌿 Blog editor</h1>
  <a href="http://localhost:4321/blog" target="_blank">open site ↗</a>
  <span class="status" id="status"></span>
  <button id="publish" title="Commit &amp; push all posts and private notes to the live site">Publish 🌱</button>
</header>
<div class="wrap">
  <aside>
    <form class="newpost" id="newForm">
      <input id="newTitle" placeholder="New post title…" />
      <button type="submit">+</button>
    </form>
    <ul id="list"></ul>
    <h2>🔒 Private notes</h2>
    <form class="newpost" id="unlockForm" autocomplete="off">
      <input id="pass" type="password" placeholder="Passphrase…" />
      <button type="submit" id="unlockBtn">Unlock</button>
    </form>
    <p class="hint" id="passHint">Encrypted in this tab. Shown at luisojeda.org/admin.</p>
    <form class="newpost" id="newNoteForm" hidden>
      <input id="newNoteTitle" placeholder="New private note…" />
      <button type="submit">+</button>
    </form>
    <ul id="notes"></ul>
  </aside>
  <main id="main"><div class="empty">Select a post, or create one.</div></main>
</div>
<script>
  let current = null;
  let kind = "post"; // or "note"
  let dirty = false;
  let passphrase = null; // only ever in this tab's memory
  let pendingPass = null; // a new passphrase waiting to be typed a second time
  const openable = new Set(); // notes the current passphrase decrypts
  const $ = (id) => document.getElementById(id);
  const api = async (path, opts) => {
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    return data;
  };

  // Same format /admin decrypts: base64(salt(16) | iv(12) | ciphertext | tag(16)),
  // AES-256-GCM, PBKDF2-SHA256 with 300k iterations.
  const ITERATIONS = 300000;
  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(text, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const body = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
    const raw = new Uint8Array(28 + body.length);
    raw.set(salt, 0); raw.set(iv, 16); raw.set(body, 28);
    let s = "";
    for (const b of raw) s += String.fromCharCode(b);
    return btoa(s);
  }
  async function decrypt(blob, password) {
    const raw = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    const key = await deriveKey(password, raw.slice(0, 16));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(16, 28) }, key, raw.slice(28));
    return new TextDecoder().decode(plain); // throws on a wrong passphrase
  }

  function listInto(ul, slugs, kindOf, label) {
    ul.innerHTML = "";
    for (const slug of slugs) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.textContent = label(slug);
      const active = slug === current && kind === kindOf;
      const locked = kindOf === "note" && !openable.has(slug);
      btn.className = (active ? "active " : "") + (locked ? "locked" : "");
      btn.onclick = () => (kindOf === "post" ? openPost(slug) : openNote(slug));
      li.appendChild(btn);
      ul.appendChild(li);
    }
  }

  async function refresh() {
    listInto($("list"), await api("/api/posts"), "post", (s) => s);
    listInto($("notes"), await api("/api/notes"), "note",
      (s) => (openable.has(s) ? "" : "🔒 ") + s.slice(11));
  }

  function showEditor(fileLabel, extra, text) {
    $("main").innerHTML =
      '<div class="toolbar"><span class="slug">' + fileLabel + '</span>' + extra +
      '<button id="save">Save</button>' +
      '<button class="danger" id="del">Delete</button></div>' +
      '<textarea id="editor" spellcheck="false"></textarea>';
    $("editor").value = text;
    $("editor").oninput = () => { dirty = true; setStatus("unsaved changes"); };
    $("save").onclick = save;
    $("del").onclick = del;
    setStatus("");
  }

  async function openPost(slug) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    const { content } = await api("/api/posts/" + slug);
    current = slug;
    kind = "post";
    dirty = false;
    showEditor(slug + ".md",
      '<a href="http://localhost:4321/blog/' + slug + '" target="_blank" style="font-size:0.85rem;color:var(--green)">preview ↗</a>',
      content);
    refresh();
  }

  async function openNote(slug, initial) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    let text = initial;
    if (text === undefined) {
      if (!openable.has(slug)) {
        if (!confirm(passphrase
            ? "This note is under a different passphrase, so it can't be opened. Delete it?"
            : "Unlock with your passphrase first. Delete this note instead?")) return;
        await api("/api/notes/" + slug, { method: "DELETE" });
        setStatus("deleted " + slug + " — Publish to remove it from the site");
        return refresh();
      }
      const plain = await decrypt((await api("/api/notes/" + slug)).blob, passphrase);
      // Notes from this editor are JSON; older ones are bare HTML.
      text = plain.startsWith("{") ? JSON.parse(plain).markdown : plain;
    }
    current = slug;
    kind = "note";
    dirty = initial !== undefined;
    showEditor("🔒 " + slug, "", text);
    if (dirty) setStatus("new note — Save to encrypt it");
    refresh();
  }

  async function save() {
    if (!current) return;
    const text = $("editor").value;
    if (kind === "post") {
      await api("/api/posts/" + current, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
    } else {
      if (!passphrase) throw new Error("locked");
      setStatus("encrypting…");
      const { html } = await api("/api/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: text }),
      });
      const blob = await encrypt(JSON.stringify({ markdown: text, html }), passphrase);
      await api("/api/notes/" + current, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blob }),
      });
      openable.add(current);
      refresh();
    }
    dirty = false;
    setStatus("saved ✓");
  }

  async function del() {
    const file = kind === "post" ? current + ".md" : "private note " + current;
    if (!confirm("Delete " + file + "? This cannot be undone.")) return;
    await api((kind === "post" ? "/api/posts/" : "/api/notes/") + current, { method: "DELETE" });
    current = null;
    dirty = false;
    $("main").innerHTML = '<div class="empty">Select a post, or create one.</div>';
    refresh();
  }

  $("unlockForm").onsubmit = async (e) => {
    e.preventDefault();
    const pw = $("pass").value;
    if (!pw) return;
    $("unlockBtn").disabled = true;
    $("passHint").textContent = "checking…";
    const slugs = await api("/api/notes");
    openable.clear();
    for (const slug of slugs) {
      try {
        await decrypt((await api("/api/notes/" + slug)).blob, pw);
        openable.add(slug);
      } catch {}
    }
    $("unlockBtn").disabled = false;

    if (openable.size === 0 && pendingPass !== pw) {
      // Nothing opens with it: treat it as a new passphrase, but make them type it twice.
      pendingPass = pw;
      $("pass").value = "";
      $("passHint").textContent = slugs.length
        ? "No notes open with that. To start using it as a new passphrase, type it again."
        : "Type it again to set your passphrase.";
      return;
    }
    if (openable.size === 0 && pw.length < 12) {
      pendingPass = null;
      $("pass").value = "";
      $("passHint").textContent = "Use at least 12 characters.";
      return;
    }
    passphrase = pw;
    pendingPass = null;
    $("pass").value = "";
    $("unlockForm").hidden = true;
    $("newNoteForm").hidden = false;
    $("passHint").textContent = openable.size
      ? "Unlocked " + openable.size + " of " + slugs.length + " note(s)."
      : "New passphrase set. New notes use it.";
    refresh();
  };

  $("newNoteForm").onsubmit = async (e) => {
    e.preventDefault();
    const title = $("newNoteTitle").value.trim();
    if (!title) return;
    const { slug } = await api("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    $("newNoteTitle").value = "";
    await openNote(slug, "# " + title + "\\n\\nWrite here...\\n");
  };

  $("newForm").onsubmit = async (e) => {
    e.preventDefault();
    const title = $("newTitle").value.trim();
    if (!title) return;
    const { slug } = await api("/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    $("newTitle").value = "";
    await openPost(slug);
  };

  function setStatus(msg) { $("status").textContent = msg; }

  $("publish").onclick = async () => {
    if (dirty) await save();
    if (!confirm("Publish all blog posts and private notes to luisojeda.org?")) return;
    const btn = $("publish");
    btn.disabled = true;
    setStatus("publishing…");
    try {
      const result = await api("/api/publish", { method: "POST" });
      setStatus(result.published
        ? "published " + result.files.length + " file(s) ✓ — live in ~1 min"
        : result.message);
    } catch (err) {
      setStatus("publish failed: " + err.message);
    } finally {
      btn.disabled = false;
    }
  };

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
  });
  window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

  refresh();
</script>
</body>
</html>`;

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Blog editor running at http://localhost:${PORT}`);
});
