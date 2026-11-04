import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
async function main(){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
  const directory=new URL('./migrations/',pathToFileURL(process.argv[1]));
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});const client=await pool.connect();
  try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('geld:migrations',0))");await client.query('CREATE TABLE IF NOT EXISTS geld_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');const files=(await readdir(directory)).filter(name=>/^\d+_[a-z_]+\.sql$/.test(name)).sort();for(const name of files){if((await client.query('SELECT name FROM geld_migrations WHERE name=$1',[name])).rowCount)continue;await client.query(await readFile(new URL(name,directory),'utf8'));await client.query('INSERT INTO geld_migrations(name) VALUES($1)',[name]);}await client.query('COMMIT');process.stdout.write('Geld schema is current.\n');}catch{await client.query('ROLLBACK');process.stderr.write('The schema update failed and was rolled back.\n');process.exitCode=1;}finally{client.release();await pool.end();}
}
void main().catch(()=>{process.stderr.write('The database connection failed.\n');process.exitCode=1;});
