const origin=process.env.GELD_JOB_ORIGIN;const secret=process.env.CRON_SECRET;
if(!origin||!secret)throw new Error('The private job origin and secret are required');
let stopped=false;process.once('SIGTERM',()=>{stopped=true;});process.once('SIGINT',()=>{stopped=true;});
while(!stopped){try{const response=await fetch(new URL('/api/jobs',origin),{headers:{Authorization:`Bearer ${secret}`},redirect:'error',signal:AbortSignal.timeout(295000)});if(!response.ok)process.stderr.write('The job runner is unavailable. It will retry.\n');}catch{process.stderr.write('The job runner could not connect. It will retry.\n');}if(!stopped)await new Promise(resolve=>setTimeout(resolve,30000));}
