const path = require("path");
const fs = require("fs");
const os = require("os");
const sharp = require("sharp");
const pngToIco = require("png-to-ico").default;

const svgPath = path.join(__dirname, "icon.svg");
const sizes = [16, 32, 48, 256];

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "posture-icon-"));
  const files = [];
  for (const size of sizes) {
    const buf = await sharp(svgPath, { density: 384 }).resize(size, size).png().toBuffer();
    const file = path.join(tmpDir, `icon-${size}.png`);
    fs.writeFileSync(file, buf);
    files.push(file);
  }

  const icoBuffer = await pngToIco(files);
  fs.writeFileSync(path.join(__dirname, "icon.ico"), icoBuffer);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // also drop a 512px PNG for reference/other platforms
  const png512 = await sharp(svgPath, { density: 384 }).resize(512, 512).png().toBuffer();
  fs.writeFileSync(path.join(__dirname, "icon.png"), png512);

  console.log("icon.ico + icon.png written to", __dirname);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
