#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const OWNER = process.env.REGISTRY_OWNER || 'Nhillation';
const REPO = process.env.REGISTRY_REPO || 'widgets';
const TAG = process.env.REGISTRY_TAG || 'catalog';
const SRC_DIR = process.env.WIDGETS_DIR || 'widgets';
const DIST_DIR = process.env.DIST_DIR || 'dist';
const BASE_URL = `https://github.com/${OWNER}/${REPO}/releases/latest/download`;

const shouldPublish = process.argv.includes('--publish');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function copyAsset(srcPath, destName) {
  fs.copyFileSync(srcPath, path.join(DIST_DIR, destName));
  return `${BASE_URL}/${destName}`;
}

function buildEntry(folderName) {
  const folderPath = path.join(SRC_DIR, folderName);
  const manifestPath = path.join(folderPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const def = manifest.default || {};
  const wd = def.widgetDetails || {};
  if (!def.name) return null;

  const zip = new AdmZip();
  zip.addLocalFolder(folderPath);
  const zipName = `${folderName}.zip`;
  zip.writeZip(path.join(DIST_DIR, zipName));
  const zipBuf = fs.readFileSync(path.join(DIST_DIR, zipName));

  let thumbnailUrl;
  if (wd.thumbnailImg && fs.existsSync(path.join(folderPath, wd.thumbnailImg))) {
    const ext = path.extname(wd.thumbnailImg);
    thumbnailUrl = copyAsset(path.join(folderPath, wd.thumbnailImg), `${folderName}-thumb${ext}`);
  }

  const previewImgs = [];
  (Array.isArray(wd.previewImgs) ? wd.previewImgs : []).forEach((img, i) => {
    const imgPath = path.join(folderPath, img);
    if (fs.existsSync(imgPath)) {
      previewImgs.push(copyAsset(imgPath, `${folderName}-preview-${i + 1}${path.extname(img)}`));
    }
  });

  return {
    id: folderName,
    folderName,
    name: def.name,
    version: wd.version || '0.0.0',
    author: wd.author,
    tagline: wd.tagline,
    description: wd.description,
    tags: wd.tags,
    category: wd.category,
    dependencies: wd.dependencies,
    thumbnailUrl,
    previewImgs,
    downloadUrl: `${BASE_URL}/${zipName}`,
    size: zipBuf.length,
    sha256: sha256(zipBuf),
  };
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Source dir "${SRC_DIR}" not found.`);
    process.exit(1);
  }
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const widgets = fs
    .readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => buildEntry(e.name))
    .filter(Boolean);

  const catalog = {
    schemaVersion: 1,
    registryVersion: new Date().toISOString().slice(0, 10),
    widgets,
  };
  fs.writeFileSync(path.join(DIST_DIR, 'catalog.json'), JSON.stringify(catalog, null, 2));
  console.log(`Built ${widgets.length} widget(s) into ${DIST_DIR}/`);

  if (!shouldPublish) {
    console.log('Dry run. Re-run with --publish to upload the GitHub release.');
    return;
  }

  const repoFlag = `--repo ${OWNER}/${REPO}`;
  const exists = (() => {
    try {
      execSync(`gh release view ${TAG} ${repoFlag}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  if (!exists) {
    execSync(`gh release create ${TAG} ${repoFlag} --title "Widget Catalog" --notes "StreamWidgets widget registry"`, { stdio: 'inherit' });
  }
  execSync(`gh release upload ${TAG} ${DIST_DIR}/* --clobber ${repoFlag}`, { stdio: 'inherit' });
  console.log('Published.');
}

main();
