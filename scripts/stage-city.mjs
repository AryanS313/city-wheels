import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(root,process.argv[2]||process.env.CITY_WHEELS_CITY_PACKAGE||'data/cities/san-francisco/city.json');
const city=JSON.parse(await readFile(source,'utf8'));
try{city.display=JSON.parse(await readFile(resolve(dirname(source),'display.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(resolve(root,'web/public/data'),{recursive:true});
await writeFile(resolve(root,'web/public/data/city.json'),JSON.stringify(city));
