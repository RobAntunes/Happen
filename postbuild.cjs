const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

function addJsExtensions(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            // Recursively process subdirectories, excluding node_modules if it somehow ends up there
            if (entry.name !== 'node_modules') {
                 addJsExtensions(fullPath);
            }
        } else if (entry.isFile() && (fullPath.endsWith('.js') || fullPath.endsWith('.mjs'))) {
            try {
                let content = fs.readFileSync(fullPath, 'utf8');
                let changed = false;

                // Regex to find relative imports/re-exports without extensions
                // Handles 'from "./file"', 'from "../file"', 'from "../../file"', etc.
                // Looks for require() as well for CommonJS output possibility.
                const importRegex = /(from\s+['"]\.\.?\/[^'"]+['"])|(require\(['"]\.\.?\/[^'"]+['"]\))/g;

                content = content.replace(importRegex, (match, fromMatch, requireMatch) => {
                    const importPathMatch = fromMatch || requireMatch;
                    // Remove 'from ' or 'require(' and quotes/parentheses
                    let importPath = importPathMatch.replace(/^(from\s+|require\()/, '').slice(1, -1);

                    // Check if the imported file likely exists without the extension
                    // This is a basic check; assumes '.js' is the target
                    const potentialFilePath = path.resolve(path.dirname(fullPath), importPath + '.js');
                    const potentialDirPath = path.resolve(path.dirname(fullPath), importPath);

                    // Only add '.js' if it doesn't already have an extension
                    // and if it's not pointing to a directory (index.js resolution)
                    if (!/\.\w+$/.test(importPath)) {
                       // Basic check: does a .js file exist or is it a directory?
                       // We add .js if the .js file exists OR if the target directory doesn't exist
                       // (implying it must be a file import needing an extension)
                       // This logic might need refinement based on actual structure
                       if (fs.existsSync(potentialFilePath) || !fs.existsSync(potentialDirPath)) {
                            changed = true;
                            console.log(`  [postbuild] Fixing: ${path.relative(__dirname, fullPath)} -> ${importPath}.js`);
                            if (fromMatch) {
                                return `from '${importPath}.js'`;
                            } else {
                                return `require('${importPath}.js')`;
                            }
                       }
                    }
                    // If no change, return the original match
                    return match;
                });

                if (changed) {
                    fs.writeFileSync(fullPath, content, 'utf8');
                }
            } catch (err) {
                 console.error(`  [postbuild] Error processing file ${fullPath}:`, err);
            }
        }
    }
}

console.log('[postbuild] Starting postbuild script...');
if (fs.existsSync(distDir)) {
    addJsExtensions(distDir);
    console.log('[postbuild] Finished adding .js extensions.');
} else {
     console.warn('[postbuild] dist directory not found. Skipping.');
} 