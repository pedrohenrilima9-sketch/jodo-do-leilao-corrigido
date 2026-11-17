document.addEventListener("DOMContentLoaded", () => {
 const $ = id => document.getElementById(id);
 let saved = {};
 try { saved = JSON.parse(sessionStorage.getItem("lf-room") || "{}"); } catch(e) {}

 let host = !!saved.host;
 let roomCode = saved.roomCode || "";
 let myName = saved.myName || "Jogador";
 let peer = null, hostConn = null, conns = [];
 let state = saved.state || null;
 let timerId = null, seconds = 0, ended = false;

 const formacoes = {
  "4-3-3":   [["PE","ATA","PD"], ["MC","MC","MEI"], ["LE","ZAG","ZAG","LD"], ["GOL"]],
  "4-2-3-1": [["ATA"], ["PE","MEI","PD"], ["VOL","VOL"], ["LE","ZAG","ZAG","LD"], ["GOL"]],
  "4-4-2":   [["ATA","ATA"], ["MEI","MC","MC","MEI"], ["LE","ZAG","ZAG","LD"], ["GOL"]],
  "3-5-2":   [["ATA","ATA"], ["MEI","MC","VOL","MC","MEI"], ["ZAG","ZAG","ZAG"], ["GOL"]],
  "3-4-3":   [["PE","ATA","PD"], ["MC","MC","MEI","MEI"], ["ZAG","ZAG","ZAG"], ["GOL"]]
 };

 const nomesPosicao = {
  GOL: "Goleiro",
  LE: "Lateral Esquerdo",
  LD: "Lateral Direito",
  ZAG: "Zagueiro",
  VOL: "Volante",
  MC: "Meio-Campista",
  MEI: "Meia Ofensivo",
  PE: "Ponta Esquerdo",
  PD: "Ponta Direito",
  ATA: "Atacante / CA"
 };

 // Regras de compatibilidade entre vaga do campo e posição original do jogador
 const compatibilidade = {
  GOL: ["GOL"],
  LE:  ["LE"],
  LD:  ["LD"],
  ZAG: ["ZAG"],
  VOL: ["VOL", "MC"],
  MC:  ["MC", "VOL", "MEI"],
  MEI: ["MEI", "MC", "PE", "PD"],
  PE:  ["PE", "MEI", "ATA"],
  PD:  ["PD", "MEI", "ATA"],
  ATA: ["ATA", "PE", "PD"]
 };

 const fmt = n => "€ " + Math.round(n || 0).toLocaleString("pt-BR");
 function msg(t) { $("mensagem").textContent = t; }
 function playersList() { return typeof jogadores !== "undefined" ? jogadores : []; }
 function currentUserId() { return host ? "host" : (saved.clientId || peer?.id || "guest"); }
 function myPlayer() { return state?.players?.[currentUserId()] || null; }

 function broadcast(data) {
  conns = conns.filter(c => c.open);
  conns.forEach(c => c.send(data));
 }

 function sendToHost(data) {
  if (host) {
   handleHostMessage(data, "host");
  } else if (hostConn?.open) {
   hostConn.send(data);
  }
 }

 function publish() {
  render();
  sessionStorage.setItem("lf-room", JSON.stringify({
   host, roomCode, myName, clientId: saved.clientId || "", state
  }));
  if (host) broadcast({ type: "state", state });
 }

 function getFormationSlots(formacao) {
  const rows = formacoes[formacao] || formacoes["4-3-3"];
  const slots = [];
  let idx = 0;
  rows.forEach((row, rIdx) => {
   row.forEach((pos, cIdx) => {
    slots.push({ id: "slot-" + idx++, pos, row: rIdx, col: cIdx });
   });
  });
  return slots;
 }

 function isCompatible(slotPos, playerPos) {
  const allowed = compatibilidade[slotPos] || [slotPos];
  return allowed.includes(playerPos);
 }

 function countLineup(player) {
  if (!player || !player.lineup) return 0;
  return Object.keys(player.lineup).length;
 }

 function allTeamsFull() {
  const players = Object.values(state?.players || {});
  if (players.length < 1) return false;
  return players.every(p => countLineup(p) >= 11);
 }

 // RENDERIZAÇÃO GERAL
 function render() {
  if (!state) return;
  $("roomLabel").textContent = "Sala " + roomCode;
  $("conexao").textContent = host ? "Você é o anfitrião da sala" : "Conectado ao anfitrião";

  const me = myPlayer();
  $("saldo").textContent = fmt(me?.budget);

  // Lista de participantes com status de quantos titulares já escalaram
  $("participantes").innerHTML = "";
  Object.values(state.players || {}).forEach(p => {
   const li = document.createElement("li");
   const esc = countLineup(p);
   li.textContent = `${p.name} — ${fmt(p.budget)} • Titulares: ${esc}/11`;
   $("participantes").appendChild(li);
  });

  // Histórico
  $("historico").innerHTML = "";
  (state.history || []).slice(-10).reverse().forEach(item => {
   const li = document.createElement("li");
   li.textContent = item;
   $("historico").appendChild(li);
  });

  // Exibir seção de escalação SOMENTE quando o leilão já tiver iniciado
  const leilaoIniciado = !!(state.auction || state.auctionStarted || state.finished);
  $("secaoEscalacao").classList.toggle("escondido", !leilaoIniciado);

  // Se o leilão terminou, esconde a disputa e mostra os resultados oficiais
  if (state.finished) {
   $("areaLeilao").classList.add("escondido");
   $("resultados").classList.remove("escondido");
   renderOfficialResults();
  } else {
   $("areaLeilao").classList.remove("escondido");
   $("resultados").classList.add("escondido");
  }

  // Dados do jogador em leilão no topo
  if (state.auction && !state.finished) {
   const a = state.auction;
   $("nomeJogador").textContent = a.player.nome;
   $("dadosJogador").textContent = `${nomesPosicao[a.player.posicao] || a.player.posicao} (${a.player.posicao}) • Overall ${a.player.overall}`;
   $("avatar").textContent = a.player.posicao === "GOL" ? "🧤" : "⚽";
   $("maiorLance").textContent = fmt(a.highestBid);
   const bidder = state.players[a.highestBidder];
   $("maiorLicitante").textContent = bidder ? bidder.name : "Sem lances ainda";
   $("timer").textContent = state.seconds + "s";

   const jaLotado = countLineup(me) >= 11 && (me?.roster?.length || 0) >= 11;
   $("darLance").disabled = !me || me.budget < a.highestBid + 1000000 || jaLotado;
   $("passar").disabled = false;
   $("darLance").textContent = "Dar lance + " + fmt(1000000);
  }

  if (leilaoIniciado && me) {
   renderEscalacao(me);
  }
 }

 // RENDERIZA CAMPO E BANCO DE RESERVAS DO JOGADOR
 function renderEscalacao(me) {
  const formacaoAtual = me.formation || "4-3-3";
  if ($("formacao").value !== formacaoAtual) {
   $("formacao").value = formacaoAtual;
  }

  const lineup = me.lineup || {};
  $("totalEscalados").textContent = Object.keys(lineup).length + "/11";

  const rows = formacoes[formacaoAtual] || formacoes["4-3-3"];
  const campo = $("campoJogadores");
  campo.innerHTML = "";
  let idx = 0;

  rows.forEach(row => {
   const line = document.createElement("div");
   line.className = "linha-jogadores";
   row.forEach(pos => {
    const slotId = "slot-" + idx++;
    const jog = lineup[slotId];
    const card = document.createElement("div");
    card.className = "card-jogador" + (jog ? "" : " vazio");
    if (jog) {
     card.innerHTML = `
      <div class="foto-jogador">${jog.nome[0]}</div>
      <strong>${jog.nome}</strong>
      <span class="posicao">${pos} (${jog.posicao})</span>
      <small>${jog.overall} ⭐</small>
     `;
    } else {
     card.innerHTML = `
      <div class="foto-jogador">+</div>
      <strong>Vaga ${pos}</strong>
      <span class="posicao">${nomesPosicao[pos] || pos}</span>
      <small>Clique p/ escalar</small>
     `;
    }
    card.onclick = () => abrirModalVaga(slotId, pos);
    line.appendChild(card);
   });
   campo.appendChild(line);
  });

  // Banco: jogadores comprados que ainda não estão no campo
  const escaladosNomes = new Set(Object.values(lineup).map(j => j.nome));
  const banco = (me.roster || []).filter(j => !escaladosNomes.has(j.nome));
  const listaBanco = $("listaBanco");
  listaBanco.innerHTML = "";

  if (!banco.length) {
   listaBanco.innerHTML = `<p style="color:#8ca4bb;font-size:13px">Nenhum jogador aguardando no banco.</p>`;
  } else {
   banco.forEach(j => {
    const item = document.createElement("div");
    item.className = "item-banco";
    item.innerHTML = `<div><strong>${j.nome}</strong> <small style="color:#27aaff">(${j.posicao})</small></div><span>${j.overall} ⭐</span>`;
    item.onclick = () => abrirModalJogadorParaVaga(j);
    listaBanco.appendChild(item);
   });
  }
 }

 // ABRIR MODAL CLICANDO NUMA VAGA DO CAMPO
 function abrirModalVaga(slotId, slotPos) {
  if (state.finished) return;
  const me = myPlayer();
  if (!me) return;

  const lineup = me.lineup || {};
  const atualNaVaga = lineup[slotId];
  const escaladosOutrosSlots = new Set(
   Object.entries(lineup).filter(([k]) => k !== slotId).map(([, v]) => v.nome)
  );

  const compativeis = (me.roster || []).filter(
   j => isCompatible(slotPos, j.posicao) && !escaladosOutrosSlots.has(j.nome)
  );

  $("posicaoSelecionada").textContent = `Vaga: ${nomesPosicao[slotPos] || slotPos} (${slotPos}) — Aceita: ${(compatibilidade[slotPos] || [slotPos]).join(", ")}`;
  const container = $("opcoesJogadores");
  container.innerHTML = "";

  if (atualNaVaga) {
   const btnRemover = document.createElement("button");
   btnRemover.className = "opcao-jogador secundario";
   btnRemover.innerHTML = `<strong>Remover ${atualNaVaga.nome} da vaga</strong><span>Enviar ao banco</span>`;
   btnRemover.onclick = () => {
    sendToHost({ type: "unassignSlot", slotId });
    fecharModais();
   };
   container.appendChild(btnRemover);
  }

  if (!compativeis.length) {
   const p = document.createElement("p");
   p.style.color = "#ffb4b4";
   p.style.fontSize = "13px";
   p.style.marginTop = "8px";
   p.textContent = "Você não possui jogadores compatíveis disponíveis para esta posição.";
   container.appendChild(p);
  } else {
   compativeis.forEach(j => {
    const b = document.createElement("button");
    b.className = "opcao-jogador";
    b.innerHTML = `<strong>${j.nome} (${j.posicao})</strong><span>${j.overall} ⭐</span>`;
    b.onclick = () => {
     sendToHost({ type: "assignSlot", slotId, playerName: j.nome });
     fecharModais();
    };
    container.appendChild(b);
   });
  }

  $("modalJogadores").classList.add("ativo");
 }

 // ABRIR MODAL CLICANDO NUM JOGADOR DO BANCO PARA ESCOLHER ONDE ELE VAI JOGAR
 function abrirModalJogadorParaVaga(jogador) {
  if (state.finished) return;
  const me = myPlayer();
  if (!me) return;

  const slots = getFormationSlots(me.formation || "4-3-3");
  const lineup = me.lineup || {};
  const slotsCompativeis = slots.filter(s => isCompatible(s.pos, jogador.posicao));

  $("jogadorParaEscalar").textContent = `${jogador.nome} (${jogador.posicao} • ${jogador.overall} ⭐)`;
  const container = $("opcoesPosicoes");
  container.innerHTML = "";

  if (!slotsCompativeis.length) {
   const p = document.createElement("p");
   p.style.color = "#ffb4b4";
   p.style.fontSize = "13px";
   p.textContent = "Nenhuma posição compatível na formação atual. Tente mudar a formação tática!";
   container.appendChild(p);
  } else {
   slotsCompativeis.forEach(s => {
    const ocupante = lineup[s.id];
    const b = document.createElement("button");
    b.className = "opcao-jogador";
    b.innerHTML = `<strong>${nomesPosicao[s.pos] || s.pos} (${s.pos})</strong><span>${ocupante ? "Substituir " + ocupante.nome : "Vaga livre"}</span>`;
    b.onclick = () => {
     sendToHost({ type: "assignSlot", slotId: s.id, playerName: jogador.nome });
     fecharModais();
    };
    container.appendChild(b);
   });
  }

  $("modalPosicoes").classList.add("ativo");
 }

 function fecharModais() {
  $("modalJogadores").classList.remove("ativo");
  $("modalPosicoes").classList.remove("ativo");
 }

 $("fecharModal").onclick = fecharModais;
 $("fecharModalPos").onclick = fecharModais;
 $("modalJogadores").onclick = e => { if (e.target === $("modalJogadores")) fecharModais(); };
 $("modalPosicoes").onclick = e => { if (e.target === $("modalPosicoes")) fecharModais(); };
 document.addEventListener("keydown", e => { if (e.key === "Escape") fecharModais(); });

 $("formacao").addEventListener("change", e => {
  sendToHost({ type: "setFormation", formation: e.target.value });
 });

 // GERAÇÃO DETERMINÍSTICA / ÚNICA DOS RESULTADOS NO ANFITRIÃO PARA QUE TODOS VEJAM EXATAMENTE O MESMO PLACAR
 function computeOfficialSimulation() {
  const players = Object.values(state.players || {});
  const tabela = {};
  players.forEach(p => {
   const titulares = Object.values(p.lineup || {});
   const forca = titulares.length
    ? Math.round(titulares.reduce((acc, j) => acc + j.overall, 0) / titulares.length)
    : 70;
   tabela[p.id] = { id: p.id, name: p.name, pts: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, forca };
  });

  const partidas = [];
  for (let i = 0; i < players.length; i++) {
   for (let j = i + 1; j < players.length; j++) {
    const a = tabela[players[i].id];
    const b = tabela[players[j].id];

    // Cálculo feito uma única vez no host e salvo no state.results
    const diff = (a.forca - b.forca) / 6;
    const ga = Math.max(0, Math.round(1.3 + diff + (Math.random() * 2.4 - 1.1)));
    const gb = Math.max(0, Math.round(1.3 - diff + (Math.random() * 2.4 - 1.1)));

    a.j++; b.j++;
    a.gp += ga; a.gc += gb;
    b.gp += gb; b.gc += ga;

    if (ga > gb) { a.pts += 3; a.v++; b.d++; }
    else if (gb > ga) { b.pts += 3; b.v++; a.d++; }
    else { a.pts += 1; b.pts += 1; a.e++; b.e++; }

    partidas.push({
     homeId: a.id, homeName: a.name, homeGoals: ga,
     awayId: b.id, awayName: b.name, awayGoals: gb
    });
   }
  }

  const classificacao = Object.values(tabela).sort(
   (x, y) => (y.pts - x.pts) || ((y.gp - y.gc) - (x.gp - x.gc)) || (y.gp - x.gp)
  );

  return { partidas, classificacao };
 }

 function renderOfficialResults() {
  const res = state.results;
  if (!res) return;

  const classDiv = $("classificacao");
  classDiv.innerHTML = "<h3>🏅 Classificação Final</h3>";
  (res.classificacao || []).forEach((t, idx) => {
   const row = document.createElement("div");
   row.className = "linha-tabela";
   row.innerHTML = `
    <span><strong>${idx + 1}º ${t.name}</strong> (Força: ${t.forca})</span>
    <span><strong>${t.pts} pts</strong> • ${t.v}V ${t.e}E ${t.d}D • SG ${t.gp - t.gc}</span>
   `;
   classDiv.appendChild(row);
  });

  const placaresDiv = $("placares");
  placaresDiv.innerHTML = "";
  (res.partidas || []).forEach(m => {
   const d = document.createElement("div");
   d.className = "placar";
   d.textContent = `${m.homeName}  ${m.homeGoals} × ${m.awayGoals}  ${m.awayName}`;
   placaresDiv.appendChild(d);
  });
 }

 // PROCESSAMENTO CENTRALIZADO NO ANFITRIÃO
 function handleHostMessage(data, from) {
  if (!host || !state) return;
  const p = state.players[from];
  if (!p) return;

  if (data.type === "bid") {
   const a = state.auction;
   if (!a || state.finished || p.budget < data.amount || data.amount <= a.highestBid) return;
   if (countLineup(p) >= 11 && (p.roster?.length || 0) >= 11) return;

   a.highestBid = data.amount;
   a.highestBidder = from;
   state.seconds = 10;
   state.history.push(`${p.name} ofereceu ${fmt(data.amount)} por ${a.player.nome}`);
   publish();
   msg(`Novo lance de ${p.name}!`);
  }

  if (data.type === "setFormation") {
   if (!formacoes[data.formation]) return;
   p.formation = data.formation;
   // Revalida jogadores escalados na nova formação; quem não couber volta pro banco
   const slots = getFormationSlots(p.formation);
   const oldLineup = Object.values(p.lineup || {});
   const newLineup = {};
   oldLineup.forEach(jog => {
    const freeSlot = slots.find(s => !newLineup[s.id] && isCompatible(s.pos, jog.posicao));
    if (freeSlot) newLineup[freeSlot.id] = jog;
   });
   p.lineup = newLineup;
   publish();
  }

  if (data.type === "assignSlot") {
   if (state.finished) return;
   const slots = getFormationSlots(p.formation || "4-3-3");
   const targetSlot = slots.find(s => s.id === data.slotId);
   const jogador = (p.roster || []).find(j => j.nome === data.playerName);
   if (!targetSlot || !jogador) return;
   if (!isCompatible(targetSlot.pos, jogador.posicao)) return;

   p.lineup = p.lineup || {};
   // Remove o jogador de qualquer outra vaga onde estivesse
   Object.keys(p.lineup).forEach(k => {
    if (p.lineup[k]?.nome === jogador.nome) delete p.lineup[k];
   });
   p.lineup[targetSlot.id] = jogador;

   publish();

   // Verifica se TODOS os participantes completaram os 11 titulares
   if (allTeamsFull()) {
    state.history.push("Todos os times completaram os 11 titulares! Leilão encerrado.");
    finishAuction();
   }
  }

  if (data.type === "unassignSlot") {
   if (state.finished || !p.lineup) return;
   delete p.lineup[data.slotId];
   publish();
  }
 }

 function autoPlaceIfPossible(playerObj, novoJogador) {
  const slots = getFormationSlots(playerObj.formation || "4-3-3");
  playerObj.lineup = playerObj.lineup || {};
  const freeSlot = slots.find(s => !playerObj.lineup[s.id] && isCompatible(s.pos, novoJogador.posicao));
  if (freeSlot) {
   playerObj.lineup[freeSlot.id] = novoJogador;
  }
 }

 function nextPlayer() {
  if (!host || ended) return;

  if (state.auction?.highestBidder) {
   const vencedor = state.players[state.auction.highestBidder];
   const j = state.auction.player;
   if (vencedor) {
    vencedor.budget -= state.auction.highestBid;
    const comprado = { ...j, valor: state.auction.highestBid };
    vencedor.roster.push(comprado);
    // Já encaixa automaticamente se houver vaga compatível livre (o usuário pode trocar depois)
    autoPlaceIfPossible(vencedor, comprado);
    state.history.push(`${vencedor.name} contratou ${j.nome} por ${fmt(state.auction.highestBid)}`);
   }
  } else if (state.auction) {
   state.history.push(`Ninguém deu lance por ${state.auction.player.nome}`);
  }

  // Se todos já completaram 11 titulares, encerra imediatamente e simula
  if (allTeamsFull()) {
   state.history.push("Todos os participantes completaram os 11 titulares!");
   finishAuction();
   return;
  }

  const available = playersList().filter(
   j => !state.used.includes(j.nome) && Object.values(state.players).some(p => countLineup(p) < 11)
  );

  if (!available.length) {
   finishAuction();
   return;
  }

  const player = available[Math.floor(Math.random() * available.length)];
  state.used.push(player.nome);
  const start = Math.max(1000000, Math.round((player.preco || 20000000) * 0.05));

  state.auction = { player, highestBid: start, highestBidder: null };
  state.seconds = 12;
  publish();
  msg("Novo jogador em leilão!");

  clearInterval(timerId);
  timerId = setInterval(() => {
   if (!host || ended) return;
   state.seconds--;
   publish();
   if (state.seconds <= 0) {
    clearInterval(timerId);
    nextPlayer();
   }
  }, 1000);
 }

 function finishAuction() {
  clearInterval(timerId);
  ended = true;
  state.finished = true;
  state.auction = null;
  state.results = computeOfficialSimulation();
  publish();
  msg("Leilão encerrado! Confira a simulação oficial abaixo.");
 }

 function startAuction() {
  if (!host) return;
  state.used = [];
  state.history = ["Leilão iniciado! Monte sua escalação abaixo conforme contratar."];
  state.finished = false;
  state.auctionStarted = true;
  state.results = null;
  ended = false;
  nextPlayer();
 }

 $("darLance").addEventListener("click", () => {
  if (!state?.auction || state.finished) return;
  const me = myPlayer();
  if (!me) return;
  sendToHost({ type: "bid", amount: state.auction.highestBid + 1000000 });
 });

 $("passar").addEventListener("click", () => msg("Você passou nesta rodada."));

 function connect() {
  if (!roomCode) {
   $("conexao").textContent = "Sala não encontrada. Volte e entre novamente.";
   return;
  }

  if (host) {
   state = state || {
    roomCode,
    players: {
     host: { id: "host", name: myName, budget: 500000000, roster: [], lineup: {}, formation: "4-3-3" }
    },
    history: [],
    used: [],
    auction: null,
    auctionStarted: false,
    finished: false,
    results: null,
    seconds: 0
   };

   Object.values(state.players).forEach(p => {
    p.roster = p.roster || [];
    p.lineup = p.lineup || {};
    p.formation = p.formation || "4-3-3";
   });

   peer = new Peer(roomCode.toLowerCase());
   peer.on("open", () => {
    conns = [];
    render();
    $("conexao").textContent = "Sala pronta. Clique em Começar leilão quando todos estiverem prontos.";
   });

   peer.on("connection", conn => {
    conns.push(conn);
    conn.on("data", data => {
     if (data.type === "hello") {
      const id = data.clientId || conn.peer;
      if (!state.players[id]) {
       state.players[id] = {
        id,
        name: data.name || "Jogador",
        budget: 500000000,
        roster: [],
        lineup: {},
        formation: "4-3-3"
       };
      }
      conn.playerId = id;
      publish();
      conn.send({ type: "state", state });
     } else {
      handleHostMessage(data, conn.playerId || conn.peer);
     }
    });
    conn.on("close", () => {
     if (conn.playerId && !state.auctionStarted) {
      delete state.players[conn.playerId];
      publish();
     }
    });
   });

   peer.on("error", e => {
    $("conexao").textContent = "Erro de conexão: " + e.type;
   });

   if (!state.auctionStarted) {
    const startButton = document.createElement("button");
    startButton.textContent = "Começar leilão";
    startButton.style.marginTop = "14px";
    startButton.addEventListener("click", () => {
     if (Object.keys(state.players).length < 2) {
      msg("Aguarde pelo menos 2 participantes na sala para começar.");
      return;
     }
     startButton.remove();
     startAuction();
    });
    $("areaBotaoIniciar").appendChild(startButton);
   }
  } else {
   const myClientId = saved.clientId || ("guest-" + Math.random().toString(36).slice(2, 10));
   saved.clientId = myClientId;
   peer = new Peer(myClientId);
   peer.on("open", () => {
    hostConn = peer.connect(roomCode.toLowerCase(), { reliable: true });
    hostConn.on("open", () => {
     hostConn.send({ type: "hello", name: myName, clientId: myClientId });
    });
    hostConn.on("data", data => {
     if (data.type === "state") {
      state = data.state;
      render();
     }
     if (data.type === "error") msg(data.message);
    });
    hostConn.on("close", () => {
     $("conexao").textContent = "Conexão com o anfitrião perdida.";
    });
   });
   peer.on("error", e => {
    $("conexao").textContent = "Erro de conexão: " + e.type;
   });
  }
 }

 connect();
});
