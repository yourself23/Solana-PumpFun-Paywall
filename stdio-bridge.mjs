#!/usr/bin/env node
import readline from "node:readline";
const ENDPOINT=process.env.MCP_ENDPOINT?.trim()||"https://solana-pumpfun-paywall.vercel.app/api/mcp";
const PAYMENT_SIGNATURE=process.env.X_PAYMENT_SIGNATURE?.trim()||"";
const API_KEY=process.env.API_KEY?.trim()||"";
const rl=readline.createInterface({input:process.stdin,terminal:false});
rl.on("line",async(line)=>{if(!line.trim())return;try{const res=await fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json",...(PAYMENT_SIGNATURE?{"x-payment-signature":PAYMENT_SIGNATURE}:{}),...(API_KEY?{"Authorization":`Bearer ${API_KEY}`}:{})},body:line});process.stdout.write((await res.text()).trim()+"\n");}catch(err){process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:null,error:{code:-32603,message:String(err)}})+"\n");}});
