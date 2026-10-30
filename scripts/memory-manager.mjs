import fs from 'fs';
import path from 'path';

export function rotateMemory(filepath) {
  const memoryDir = process.env.MEMORY_DIR || './memory';
  const fullPath = path.resolve(memoryDir, filepath);
  
  if (fs.existsSync(fullPath)) {
    const stats = fs.statSync(fullPath);
    // basic rotation logic: if file is larger than 1MB, rename it
    if (stats.size > 1024 * 1024) {
      const rotatedPath = `${fullPath}.${Date.now()}.bak`;
      fs.renameSync(fullPath, rotatedPath);
      console.log(`Rotated memory file: ${filepath} to ${rotatedPath}`);
      return rotatedPath;
    }
  }
  return fullPath;
}
