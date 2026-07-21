// Local-only blog editor. Run with `npm run edit`, open http://localhost:4444.
// Writes markdown files in src/content/blog/ — the Astro dev server picks up
// changes instantly, so localhost:4321 is the live preview.
import { createServer } from "node:http";
import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const PORT = 4444;
const BLOG_DIR = new URL("./src/content/blog/", import.meta.url).pathname;

function slugOf(url) {
  const slug = decodeURIComponent(url.split("/api/posts/")[1] ?? "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`bad slug: ${slug}`);
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
</style>
</head>
<body>
<header>
  <h1>🌿 Blog editor</h1>
  <a href="http://localhost:4321/blog" target="_blank">open site ↗</a>
  <span class="status" id="status"></span>
</header>
<div class="wrap">
  <aside>
    <form class="newpost" id="newForm">
      <input id="newTitle" placeholder="New post title…" />
      <button type="submit">+</button>
    </form>
    <ul id="list"></ul>
  </aside>
  <main id="main"><div class="empty">Select a post, or create one.</div></main>
</div>
<script>
  let current = null;
  let dirty = false;
  const $ = (id) => document.getElementById(id);
  const api = async (path, opts) => {
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    return data;
  };

  async function refresh() {
    const posts = await api("/api/posts");
    $("list").innerHTML = "";
    for (const slug of posts) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.textContent = slug;
      btn.className = slug === current ? "active" : "";
      btn.onclick = () => open(slug);
      li.appendChild(btn);
      $("list").appendChild(li);
    }
  }

  async function open(slug) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    const { content } = await api("/api/posts/" + slug);
    current = slug;
    dirty = false;
    $("main").innerHTML =
      '<div class="toolbar"><span class="slug">' + slug + '.md</span>' +
      '<a href="http://localhost:4321/blog/' + slug + '" target="_blank" style="font-size:0.85rem;color:var(--green)">preview ↗</a>' +
      '<button id="save">Save</button>' +
      '<button class="danger" id="del">Delete</button></div>' +
      '<textarea id="editor" spellcheck="false"></textarea>';
    $("editor").value = content;
    $("editor").oninput = () => { dirty = true; setStatus("unsaved changes"); };
    $("save").onclick = save;
    $("del").onclick = del;
    setStatus("");
    refresh();
  }

  async function save() {
    if (!current) return;
    await api("/api/posts/" + current, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: $("editor").value }),
    });
    dirty = false;
    setStatus("saved ✓");
  }

  async function del() {
    if (!confirm("Delete " + current + ".md? This cannot be undone.")) return;
    await api("/api/posts/" + current, { method: "DELETE" });
    current = null;
    dirty = false;
    $("main").innerHTML = '<div class="empty">Select a post, or create one.</div>';
    refresh();
  }

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
    await open(slug);
  };

  function setStatus(msg) { $("status").textContent = msg; }

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
