const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "public");
const rooms = new Map();
const QUESTIONS = [
 {q:"Which planet is known as the Red Planet?",a:"Mars",o:["Venus","Mars","Jupiter","Mercury"],c:"Space"},
 {q:"What is the largest ocean on Earth?",a:"Pacific Ocean",o:["Atlantic Ocean","Indian Ocean","Pacific Ocean","Arctic Ocean"],c:"Geography"},
 {q:"How many sides does a hexagon have?",a:"6",o:["5","6","7","8"],c:"Science"},
 {q:"Which gas do plants absorb from the atmosphere?",a:"Carbon dioxide",o:["Oxygen","Nitrogen","Carbon dioxide","Hydrogen"],c:"Science"},
 {q:"What is the capital of Japan?",a:"Tokyo",o:["Kyoto","Seoul","Tokyo","Osaka"],c:"Geography"},
 {q:"Which instrument measures temperature?",a:"Thermometer",o:["Barometer","Thermometer","Hygrometer","Altimeter"],c:"Science"},
 {q:"How many minutes are in two hours?",a:"120",o:["100","110","120","140"],c:"General"},
 {q:"Which animal is the largest mammal?",a:"Blue whale",o:["African elephant","Giraffe","Blue whale","Great white shark"],c:"Nature"},
 {q:"What is the chemical symbol for gold?",a:"Au",o:["Ag","Gd","Go","Au"],c:"Science"},
 {q:"Which continent is the Sahara Desert in?",a:"Africa",o:["Asia","Africa","Australia","South America"],c:"Geography"},
 {q:"How many colors are traditionally listed in a rainbow?",a:"7",o:["5","6","7","8"],c:"General"},
 {q:"Which is the closest star to Earth?",a:"The Sun",o:["Sirius","Proxima Centauri","Polaris","The Sun"],c:"Space"},
 {q:"What is the square root of 81?",a:"9",o:["8","9","7","10"],c:"Math"},
 {q:"Which language is primarily spoken in Brazil?",a:"Portuguese",o:["Spanish","Portuguese","French","English"],c:"Culture"},
 {q:"At sea level, water boils at what Celsius temperature?",a:"100°C",o:["90°C","95°C","100°C","110°C"],c:"Science"},
 {q:"Which organ pumps blood around the human body?",a:"Heart",o:["Liver","Lungs","Brain","Heart"],c:"Science"},
 {q:"What is the largest planet in our solar system?",a:"Jupiter",o:["Saturn","Earth","Jupiter","Neptune"],c:"Space"},
 {q:"How many days are in a leap year?",a:"366",o:["364","365","366","367"],c:"General"},
 {q:"Which metal is liquid at typical room temperature?",a:"Mercury",o:["Iron","Mercury","Aluminium","Copper"],c:"Science"},
 {q:"What is the process by which plants make food using sunlight?",a:"Photosynthesis",o:["Respiration","Fermentation","Photosynthesis","Transpiration"],c:"Science"},
 {q:"How many degrees are in a right angle?",a:"90",o:["45","60","90","180"],c:"Math"},
 {q:"Which country is home to the Great Pyramid of Giza?",a:"Egypt",o:["Mexico","Egypt","Greece","India"],c:"History"},
 {q:"What is the freezing point of water in Celsius?",a:"0°C",o:["0°C","10°C","32°C","100°C"],c:"Science"},
 {q:"Which bird is famous for its ability to mimic human speech?",a:"Parrot",o:["Penguin","Parrot","Ostrich","Eagle"],c:"Nature"}
];
const uid=()=>crypto.randomBytes(8).toString("hex");
const norm=s=>String(s??"").trim().toLowerCase();
function json(res,status,obj){res.writeHead(status,{"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Cache-Control":"no-store"});res.end(JSON.stringify(obj));}
function readBody(req){return new Promise((resolve,reject)=>{let b="";req.on("data",d=>{b+=d;if(b.length>1e6)reject(new Error("Request too large"));});req.on("end",()=>{try{resolve(JSON.parse(b||"{}"));}catch(e){reject(e);}});});}
function safeRoom(r,viewerId){
 const current=r.current?{
  claimantId:r.current.claimantId,question:r.current.question,category:r.current.category,options:r.current.options,
  answerText:r.current.answerText,truthRevealed:r.current.truthRevealed,bluffRevealed:r.current.bluffRevealed,
  result:r.phase==="reveal"||r.phase==="finished"?r.current.result:null,
  predictions:(r.phase==="reveal"||r.phase==="finished")?r.current.predictions:{},
  lockedPlayers:Object.keys(r.current.predictions)
 }:null;
 return {code:r.code,hostId:r.hostId,status:r.status,round:r.round,totalRounds:r.totalRounds,phase:r.phase,
  players:[...r.players.values()].map(p=>({id:p.id,name:p.name,score:p.score,tokens:p.tokens,connected:p.connected})),
  current,myPlayerId:viewerId,message:r.message,deadline:r.deadline};
}
function broadcast(r){r.updated=Date.now();}
function schedule(ms,fn){setTimeout(fn,ms);}
function startRound(r){
 r.round++;
 if(r.round>r.totalRounds){r.status="finished";r.phase="finished";r.message="Game over!";broadcast(r);return;}
 const available=QUESTIONS.filter(q=>!r.used.has(q.q)); if(!available.length)r.used.clear();
 const list=available.length?available:QUESTIONS;
 const q=list[Math.floor(Math.random()*list.length)];r.used.add(q.q);
 const claimant=[...r.players.values()][(r.round-1)%r.players.size];
 r.current={claimantId:claimant.id,question:q.q,correctAnswer:q.a,category:q.c,options:q.o,answerText:null,bluff:null,answerCorrect:null,predictions:{},result:null};
 r.phase="answer";r.message=`Round ${r.round}: ${claimant.name} is the featured player.`;r.deadline=Date.now()+20000;broadcast(r);
 schedule(20000,()=>{if(r.phase!=="answer"||r.current?.claimantId!==claimant.id)return;const wrong=q.o.filter(x=>x!==q.a);r.current.answerText=wrong[Math.floor(Math.random()*wrong.length)];r.current.answerCorrect=false;r.current.bluff=true;beginDebate(r);});
}
function beginDebate(r){r.phase="debate";r.message="Claim submitted. Debate is open.";r.deadline=Date.now()+30000;broadcast(r);schedule(30000,()=>{if(r.phase==="debate")beginBets(r);});}
function beginBets(r){r.phase="bets";r.message="Lock your predictions before the timer ends.";r.deadline=Date.now()+15000;broadcast(r);schedule(15000,()=>{if(r.phase==="bets")reveal(r);});}
function reveal(r){
 const c=r.current;c.result={correctAnswer:c.correctAnswer,submittedAnswer:c.answerText,answerCorrect:c.answerCorrect,bluff:c.bluff};
 const preds=Object.values(c.predictions), claimant=r.players.get(c.claimantId);
 for(const p of r.players.values()){
  if(p.id===c.claimantId){
   if(c.bluff){if(preds.some(x=>x.truth==="true"&&c.answerCorrect===false))p.score+=4;}
   else if(!preds.some(x=>x.bluffer==="true"))p.score+=1;
   continue;
  }
  const pred=c.predictions[p.id];if(!pred)continue;
  if(pred.truth!==null){if(pred.truth===String(c.answerCorrect))p.score+=3;else p.score=Math.max(0,p.score-1);}
  if(pred.bluffer!==null){if(pred.bluffer===String(c.bluff))p.score+=4;else p.score=Math.max(0,p.score-1);}
  for(const kind of ["truth","bluffer"]){
   const choice=pred[kind],stake=pred[kind+"Stake"];if(choice===null||stake===0)continue;
   const correct=kind==="truth"?choice===String(c.answerCorrect):choice===String(c.bluff);
   p.tokens=Math.max(0,p.tokens+(correct?stake:-stake));
  }
 }
 r.phase="reveal";r.message="The truth is out!";r.deadline=Date.now()+8000;broadcast(r);
 schedule(8000,()=>{if(r.phase==="reveal"){if(r.round>=r.totalRounds){r.status="finished";r.phase="finished";r.message="Match complete!";broadcast(r);}else startRound(r);}});
}
async function action(req,res){
 const body=await readBody(req), event=body.event, d=body.data||{};
 if(event==="createRoom"){
  let code;do{code=crypto.randomBytes(3).toString("hex").toUpperCase();}while(rooms.has(code));
  const id=uid(),r={code,hostId:id,status:"lobby",phase:"lobby",round:0,totalRounds:8,players:new Map(),used:new Set(),current:null,message:"Waiting for players.",updated:Date.now()};
  r.players.set(id,{id,name:String(d.name||"Player 1").slice(0,20),score:0,tokens:10,connected:true});
  rooms.set(code,r);return json(res,200,{ok:true,code,playerId:id,state:safeRoom(r,id)});
 }
 if(event==="joinRoom"){
  const r=rooms.get(String(d.code||"").toUpperCase());if(!r)return json(res,200,{ok:false,error:"Room code not found."});
  if(r.status!=="lobby")return json(res,200,{ok:false,error:"This game has already started."});
  if(r.players.size>=8)return json(res,200,{ok:false,error:"This room is full (8 players maximum)."});
  const id=uid();r.players.set(id,{id,name:String(d.name||`Player ${r.players.size+1}`).slice(0,20),score:0,tokens:10,connected:true});broadcast(r);
  return json(res,200,{ok:true,code:r.code,playerId:id,state:safeRoom(r,id)});
 }
 const r=rooms.get(String(d.code||"").toUpperCase()),p=r?.players.get(String(d.playerId||""));
 if(!r||!p)return json(res,200,{ok:false,error:"Room or player session not found. Return to the lobby and rejoin."});
 if(event==="startGame"){
  if(r.hostId!==p.id)return json(res,200,{ok:false,error:"Only the host can start."});
  if(r.players.size<2)return json(res,200,{ok:false,error:"At least 2 players are required."});
  r.status="playing";r.totalRounds=Math.max(8,r.players.size);r.round=0;startRound(r);return json(res,200,{ok:true});
 }
 if(event==="submitAnswer"){
  if(r.phase!=="answer"||r.current.claimantId!==p.id)return json(res,200,{ok:false,error:"It is not your answer turn."});
  const q=QUESTIONS.find(x=>x.q===r.current.question),ans=String(d.answer||"").slice(0,100),initial=norm(ans)===norm(q.a);
  r.current.bluff=Boolean(d.bluff);
  if(r.current.bluff){const wrong=q.o.filter(x=>norm(x)!==norm(q.a));r.current.answerText=initial?wrong[Math.floor(Math.random()*wrong.length)]:ans;r.current.answerCorrect=false;}
  else {r.current.answerText=ans;r.current.answerCorrect=initial;}
  beginDebate(r);return json(res,200,{ok:true});
 }
 if(event==="submitBets"){
  if(r.phase!=="bets"||p.id===r.current.claimantId)return json(res,200,{ok:false,error:"Wagers are not open for you."});
  const ts=Math.max(0,Math.min(3,Number(d.truthStake)||0)),bs=Math.max(0,Math.min(3,Number(d.blufferStake)||0));
  const truth=d.truth===""||d.truth==null?null:String(d.truth),bluffer=d.bluffer===""||d.bluffer==null?null:String(d.bluffer);
  const effectiveTs=truth===null?0:ts, effectiveBs=bluffer===null?0:bs;
  if(effectiveTs+effectiveBs>p.tokens)return json(res,200,{ok:false,error:"Not enough tokens for both wagers."});
  if(r.current.predictions[p.id])return json(res,200,{ok:false,error:"Your predictions are already locked."});
  r.current.predictions[p.id]={truth,bluffer,truthStake:effectiveTs,blufferStake:effectiveBs};
  broadcast(r);return json(res,200,{ok:true});
 }
 if(event==="nextRound"){
  if(r.phase!=="reveal"||r.hostId!==p.id)return json(res,200,{ok:false,error:"Only the host can continue after the reveal."});
  if(r.round>=r.totalRounds){r.status="finished";r.phase="finished";broadcast(r);}else startRound(r);
  return json(res,200,{ok:true});
 }
 return json(res,400,{ok:false,error:"Unknown action."});
}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://localhost");
 if(req.method==="GET"&&(url.pathname==="/"||url.pathname==="/index.html")){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});return fs.createReadStream(path.join(ROOT,"index.html")).pipe(res);}
 if(req.method==="GET"&&url.pathname==="/api/state"){
  const r=rooms.get((url.searchParams.get("code")||"").toUpperCase()),id=url.searchParams.get("playerId");
  if(!r||!r.players.has(id))return json(res,404,{ok:false,error:"Room session not found."});
  return json(res,200,{ok:true,state:safeRoom(r,id)});
 }
 if(req.method==="POST"&&url.pathname==="/api/action"){try{return await action(req,res);}catch(e){return json(res,400,{ok:false,error:"Invalid request."});}}
 if(req.method==="GET"&&url.pathname==="/health")return json(res,200,{ok:true,rooms:rooms.size});
 res.writeHead(404,{"Content-Type":"text/plain"});res.end("Not found");
});
server.listen(PORT,"0.0.0.0",()=>console.log(`Bluff or Bust running at http://localhost:${PORT}`));
