// Copies the built plugin into Tabby's user plugin folder and moves the
// three standalone plugins it replaces out of the way (they would conflict).
const fs = require('fs')
const os = require('os')
const path = require('path')

const pluginsDir = path.join(os.homedir(), '.config', 'tabby', 'plugins', 'node_modules')
const target = path.join(pluginsDir, 'tabby-workspace')
const replaced = ['tabby-background', 'tabby-server-stats', 'tabby-ssh-sidebar']
const backupDir = path.join(os.homedir(), '.config', 'tabby', 'plugins-disabled')

for (const name of replaced) {
    const src = path.join(pluginsDir, name)
    if (fs.existsSync(src)) {
        fs.mkdirSync(backupDir, { recursive: true })
        const dest = path.join(backupDir, name)
        fs.rmSync(dest, { recursive: true, force: true })
        fs.renameSync(src, dest)
        console.log(`moved ${name} -> ${dest}`)
    }
}

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
fs.cpSync(path.join(__dirname, '..', 'dist'), path.join(target, 'dist'), { recursive: true })
fs.copyFileSync(path.join(__dirname, '..', 'package.json'), path.join(target, 'package.json'))
console.log(`installed to ${target} — restart Tabby`)
