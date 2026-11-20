#!/usr/bin/env node
import readline from "node:readline";
const ENDPOINT=process.env.MCP_ENDPOINT||"https://vercel.app";
const rl=readline.createInterface({input:process.stdin,terminal:false});
rl.on("line",async(line)=>{if(!line.trim())return;try{const res=await fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json",...(process.env.X_PAYMENT_SIGNATURE?{"x-payment-signature":process.env.X_PAYMENT_SIGNATURE}:{}),...(process.env.API_KEY?{"Authorization":`Bearer ${process.env.API_KEY}`}:{})},body:line});process.stdout.write((await res.text()).trim()+"\n");}catch(err){process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:null,error:{code:-32603,message:String(err)}})+"\n");}});
