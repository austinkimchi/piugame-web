import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = path.resolve(root, "..", "piugame-sdk");

const copies = [
  {
    from: path.join(sdkRoot, "phoenix_data", "song_img"),
    to: path.join(root, "public", "assets", "piu", "phoenix", "song_img"),
  },
  {
    from: path.join(sdkRoot, "data", "song_img2"),
    to: path.join(root, "public", "assets", "piu", "phoenix2", "song_img2"),
  },
];

await mkdir(path.join(root, "public", "assets", "piu"), { recursive: true });

for (const copy of copies) {
  await cp(copy.from, copy.to, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
  console.log(`Synced ${path.relative(root, copy.from)} -> ${path.relative(root, copy.to)}`);
}
