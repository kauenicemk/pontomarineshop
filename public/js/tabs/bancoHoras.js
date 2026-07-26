import { api } from '../api.js';
import { escapeHtml, mesAtualISO, primeiroNome } from '../utils.js';

/**
 * CONTROLE DE HORAS — a métrica muda conforme o regime, porque os três contratos
 * medem coisas diferentes:
 *
 *   ESTAGIARIO → banco de horas: saldo acumulado (pode ficar negativo)
 *   CLT        → horas extras acumuladas no mês (o saldo aparece à parte, nos cartões)
 *   PJ         → horas trabalhadas: não tem jornada fixa nem hora extra, é pago por hora
 *
 * Bug que existia aqui: o gráfico lia o saldo do texto formatado ("+01:30") e
 * descartava tudo que viesse como "---". Só que o saldo é "---" sempre que o dia
 * não tem meta — domingo, feriado e folga. Resultado: quem trabalhou num domingo
 * não aparecia em lugar nenhum, e um mês com trabalho só nesses dias ficava
 * completamente vazio. Agora os números vêm prontos da API (saldoMinutos,
 * horas_extras.minutos, trabalhadoMinutos) e dia sem meta conta como crédito.
 *
 * O gráfico é desenhado à mão no <canvas> de propósito: qualquer lib de gráfico
 * viria de CDN, e se a rede da loja bloquear o endereço o gráfico some sem erro visível.
 */

const REGIMES = {
    CLT: {
        rotulo: 'CLT',
        titulo: 'Horas extras',
        unidadeAcumulada: 'Horas extras no mês',
        explicacao: 'Para CLT, o que importa é a hora extra acumulada. O saldo do mês aparece nos cartões acima.',
        cor: '--accent',
        sempreCrescente: true
    },
    ESTAGIARIO: {
        rotulo: 'Estagiário',
        titulo: 'Banco de horas',
        unidadeAcumulada: 'Saldo acumulado',
        explicacao: 'Banco de horas: o saldo sobe quando trabalha além da meta e desce quando fica abaixo.',
        cor: '--azul',
        sempreCrescente: false
    },
    PJ: {
        rotulo: 'PJ',
        titulo: 'Horas trabalhadas',
        unidadeAcumulada: 'Horas trabalhadas',
        explicacao: 'PJ não tem jornada fixa nem hora extra — o que conta é o total de horas trabalhadas no mês.',
        cor: '--verde',
        sempreCrescente: true
    }
};

let funcionariosPorId = {};
let grafico = null; // instância do gráfico atual (guarda os pontos para o hover)

/* ===================== Métrica por regime ===================== */

/**
 * Quanto o dia rendeu, na métrica do regime da pessoa (em minutos).
 * Dia sem meta (domingo, feriado, folga) não tem saldo calculável — nesses casos
 * TODO o tempo trabalhado é crédito, que é justamente o que a API já devolve
 * como hora extra.
 */
function valorDoDia(dia, regime) {
    if (regime === 'PJ') return dia.trabalhadoMinutos || 0;
    if (regime === 'CLT') return dia.horas_extras?.minutos || 0;
    // Estagiário: banco de horas
    if (dia.saldoMinutos !== null && dia.saldoMinutos !== undefined) return dia.saldoMinutos;
    return dia.horas_extras?.minutos || 0;
}

function regimeDe(funcionarioId) {
    return funcionariosPorId[funcionarioId]?.regime || 'CLT';
}

/* ===================== Formatação ===================== */

function minutosParaHoras(min) {
    const sinal = min < 0 ? '-' : '';
    const abs = Math.abs(Math.round(min));
    return `${sinal}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, '0')}`;
}

function cor(nomeVariavel, alternativa) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(nomeVariavel).trim();
    return v || alternativa;
}

function ultimoDiaDoMes(mesISO) {
    const [ano, mes] = mesISO.split('-').map(Number);
    return new Date(ano, mes, 0).getDate();
}

/* ===================== Seletor ===================== */

export function popularSeletorBanco(funcionarios) {
    const sel = document.getElementById('banco-colaborador');
    const valorAtual = sel.value;

    funcionariosPorId = {};
    funcionarios.forEach((f) => { funcionariosPorId[f.id] = f; });

    sel.innerHTML = '<option value="__todos__">Todos os colaboradores</option>' +
        funcionarios.map((f) => {
            const r = REGIMES[f.regime] || REGIMES.CLT;
            return `<option value="${f.id}">${escapeHtml(f.nome)} · ${escapeHtml(r.rotulo)}</option>`;
        }).join('');
    if (valorAtual) sel.value = valorAtual;

    const mesInput = document.getElementById('banco-mes');
    if (!mesInput.value) mesInput.value = mesAtualISO();
}

/* ===================== Gráfico de área (progressão do mês) ===================== */

/** Interpolação suave entre pontos (Catmull-Rom convertido em curva de Bézier). */
function caminhoSuave(ctx, pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        ctx.bezierCurveTo(
            p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
            p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
            p2.x, p2.y
        );
    }
}

function criarGraficoArea(canvas, pontos, opcoes) {
    const { corLinha, permiteNegativo } = opcoes;
    const dpr = window.devicePixelRatio || 1;
    const largura = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const altura = 280;
    canvas.style.height = `${altura}px`;
    canvas.width = largura * dpr;
    canvas.height = altura * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const margem = { esq: 56, dir: 18, topo: 18, base: 34 };
    const areaL = largura - margem.esq - margem.dir;
    const areaA = altura - margem.topo - margem.base;

    const valores = pontos.map((p) => p.acumulado);
    let min = permiteNegativo ? Math.min(0, ...valores) : 0;
    let max = Math.max(...valores, min + 60);
    const folga = (max - min) * 0.12 || 30;
    max += folga;
    if (permiteNegativo && min < 0) min -= folga;

    const escalaY = areaA / (max - min);
    const y = (v) => margem.topo + areaA - (v - min) * escalaY;
    const passo = pontos.length > 1 ? areaL / (pontos.length - 1) : 0;
    const pts = pontos.map((p, i) => ({ x: margem.esq + passo * i, y: y(p.acumulado), dado: p }));

    const corTexto = cor('--texto-mudo', '#94a3b8');
    const corGrade = cor('--border', '#273043');

    function desenhar(progresso, indiceHover) {
        ctx.clearRect(0, 0, largura, altura);

        // Grade horizontal + rótulos do eixo Y
        ctx.font = '11px Manrope, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const linhas = 4;
        for (let i = 0; i <= linhas; i++) {
            const valor = min + ((max - min) / linhas) * i;
            const yy = y(valor);
            ctx.strokeStyle = corGrade;
            ctx.globalAlpha = valor === 0 ? 0.9 : 0.35;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(margem.esq, yy);
            ctx.lineTo(largura - margem.dir, yy);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillStyle = corTexto;
            ctx.fillText(minutosParaHoras(valor), margem.esq - 10, yy);
        }

        if (pts.length === 0) return;

        // A área e a linha são reveladas da esquerda para a direita: dá a leitura
        // de "o mês foi acontecendo" em vez de aparecer tudo pronto de uma vez.
        const limiteX = margem.esq + areaL * progresso;
        ctx.save();
        ctx.beginPath();
        ctx.rect(margem.esq - 1, 0, Math.max(0, limiteX - margem.esq + 1), altura);
        ctx.clip();

        const zeroY = Math.min(Math.max(y(0), margem.topo), margem.topo + areaA);

        // Preenchimento com degradê suave até a linha de base
        const grad = ctx.createLinearGradient(0, margem.topo, 0, margem.topo + areaA);
        grad.addColorStop(0, corLinha + '55');
        grad.addColorStop(1, corLinha + '05');
        ctx.beginPath();
        ctx.moveTo(pts[0].x, zeroY);
        ctx.lineTo(pts[0].x, pts[0].y);
        caminhoSuave(ctx, pts);
        ctx.lineTo(pts[pts.length - 1].x, zeroY);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Linha
        ctx.beginPath();
        caminhoSuave(ctx, pts);
        ctx.strokeStyle = corLinha;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();

        // Ponto final destacado (onde o mês está agora)
        const ultimoVisivel = Math.min(pts.length - 1, Math.floor((pts.length - 1) * progresso));
        const pf = pts[ultimoVisivel];
        if (pf) {
            ctx.beginPath();
            ctx.arc(pf.x, pf.y, 5.5, 0, Math.PI * 2);
            ctx.fillStyle = corLinha;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(pf.x, pf.y, 9, 0, Math.PI * 2);
            ctx.strokeStyle = corLinha + '55';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Rótulos do eixo X (alguns dias, pra não poluir)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = corTexto;
        ctx.font = '10.5px Manrope, sans-serif';
        const salto = Math.max(1, Math.ceil(pts.length / 8));
        pts.forEach((p, i) => {
            if (i % salto === 0 || i === pts.length - 1) {
                ctx.fillText(p.dado.rotuloCurto, p.x, altura - 12);
            }
        });

        // Marcador do hover
        if (indiceHover !== null && pts[indiceHover]) {
            const p = pts[indiceHover];
            ctx.strokeStyle = corGrade;
            ctx.globalAlpha = 0.8;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(p.x, margem.topo);
            ctx.lineTo(p.x, margem.topo + areaA);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;

            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = cor('--card', '#121c30');
            ctx.fill();
            ctx.strokeStyle = corLinha;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
    }

    return { desenhar, pts, largura, altura };
}

function animarGrafico(g, canvas) {
    const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduzirMovimento) { g.desenhar(1, null); return; }

    const duracao = 650;
    const inicio = performance.now();
    function passo(agora) {
        const t = Math.min(1, (agora - inicio) / duracao);
        const suave = 1 - Math.pow(1 - t, 3); // desacelera no fim
        g.desenhar(suave, null);
        if (t < 1 && canvas.isConnected) requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);
}

/* ===================== Gráfico de barras (todos) ===================== */

function desenharBarras(canvas, itens) {
    const dpr = window.devicePixelRatio || 1;
    const largura = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const altura = 280;
    canvas.style.height = `${altura}px`;
    canvas.width = largura * dpr;
    canvas.height = altura * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const margem = { esq: 56, dir: 18, topo: 22, base: 46 };
    const areaL = largura - margem.esq - margem.dir;
    const areaA = altura - margem.topo - margem.base;

    const valores = itens.map((i) => i.valor);
    const min = Math.min(0, ...valores);
    const max = Math.max(...valores, 60);
    const escalaY = areaA / ((max - min) || 1);
    const y = (v) => margem.topo + areaA - (v - min) * escalaY;

    const corTexto = cor('--texto-mudo', '#94a3b8');
    const corGrade = cor('--border', '#273043');

    ctx.clearRect(0, 0, largura, altura);
    ctx.font = '11px Manrope, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
        const valor = min + ((max - min) / 4) * i;
        const yy = y(valor);
        ctx.strokeStyle = corGrade;
        ctx.globalAlpha = valor === 0 ? 0.9 : 0.3;
        ctx.beginPath();
        ctx.moveTo(margem.esq, yy);
        ctx.lineTo(largura - margem.dir, yy);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = corTexto;
        ctx.fillText(minutosParaHoras(valor), margem.esq - 10, yy);
    }

    const passo = areaL / itens.length;
    const larguraBarra = Math.min(52, passo * 0.55);
    const raio = Math.min(6, larguraBarra / 2);
    const zeroY = y(0);

    itens.forEach((item, i) => {
        const x = margem.esq + passo * i + passo / 2;
        const topo = y(item.valor);
        const alturaBarra = Math.abs(topo - zeroY);
        const corBarra = cor(REGIMES[item.regime]?.cor || '--accent', '#f0821e');

        ctx.beginPath();
        const yTopo = item.valor >= 0 ? topo : zeroY;
        ctx.roundRect(x - larguraBarra / 2, yTopo, larguraBarra, Math.max(2, alturaBarra), raio);
        ctx.fillStyle = corBarra;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = cor('--texto', '#f2f5fa');
        ctx.font = '600 11.5px Manrope, sans-serif';
        ctx.fillText(minutosParaHoras(item.valor), x, item.valor >= 0 ? yTopo - 7 : yTopo + alturaBarra + 15);

        ctx.fillStyle = corTexto;
        ctx.font = '10.5px Manrope, sans-serif';
        ctx.fillText(primeiroNome(item.nome), x, altura - 26);
        ctx.fillStyle = corBarra;
        ctx.font = '9.5px Manrope, sans-serif';
        ctx.fillText(REGIMES[item.regime]?.rotulo || item.regime, x, altura - 12);
    });
}

/* ===================== Cartões de resumo ===================== */

function cartao(rotulo, valor, corValor) {
    return `<div class="cartao-resumo">
        <span class="cartao-resumo-valor" style="color:${corValor || 'var(--texto)'}">${escapeHtml(valor)}</span>
        <span class="cartao-resumo-rotulo">${escapeHtml(rotulo)}</span>
    </div>`;
}

function mensagemVazia(canvas, texto) {
    const dpr = window.devicePixelRatio || 1;
    const largura = canvas.clientWidth || 600;
    const altura = 200;
    canvas.style.height = `${altura}px`;
    canvas.width = largura * dpr;
    canvas.height = altura * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, largura, altura);
    ctx.fillStyle = cor('--texto-mudo', '#94a3b8');
    ctx.font = '13px Manrope, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(texto, largura / 2, altura / 2);
}

/* ===================== Render principal ===================== */

export async function renderizarGraficoBanco() {
    const canvas = document.getElementById('grafico-banco-horas');
    const legenda = document.getElementById('banco-horas-legenda');
    const resumo = document.getElementById('banco-resumo-individual');
    const mes = document.getElementById('banco-mes').value || mesAtualISO();
    const selecionado = document.getElementById('banco-colaborador').value;

    grafico = null;
    mensagemVazia(canvas, 'Carregando...');

    let dados;
    try {
        const inicio = `${mes}-01`;
        const fim = `${mes}-${String(ultimoDiaDoMes(mes)).padStart(2, '0')}`;
        dados = await api.relatorioCalculado(inicio, fim);
    } catch (e) {
        resumo.innerHTML = '';
        mensagemVazia(canvas, 'Não foi possível carregar os dados.');
        legenda.textContent = e.message;
        return;
    }

    if (selecionado === '__todos__') renderizarTodos(dados, canvas, resumo, legenda);
    else renderizarIndividual(dados, Number(selecionado), canvas, resumo, legenda);
}

function renderizarTodos(dados, canvas, resumo, legenda) {
    const porFuncionario = {};
    dados.forEach((d) => {
        const regime = regimeDe(d.funcionarioId) || d.regime;
        if (!porFuncionario[d.funcionarioId]) {
            porFuncionario[d.funcionarioId] = { nome: d.nome, regime, valor: 0 };
        }
        porFuncionario[d.funcionarioId].valor += valorDoDia(d, regime);
    });

    const itens = Object.values(porFuncionario).sort((a, b) => b.valor - a.valor);

    // Totais por regime — cada um na sua métrica
    const totais = { CLT: 0, ESTAGIARIO: 0, PJ: 0 };
    itens.forEach((i) => { totais[i.regime] = (totais[i.regime] || 0) + i.valor; });

    resumo.innerHTML = `<div class="cartoes-resumo">
        ${cartao('Horas extras (CLT)', minutosParaHoras(totais.CLT || 0), 'var(--accent)')}
        ${cartao('Banco de horas (estagiários)', minutosParaHoras(totais.ESTAGIARIO || 0), (totais.ESTAGIARIO || 0) >= 0 ? 'var(--verde)' : 'var(--vermelho)')}
        ${cartao('Horas trabalhadas (PJ)', minutosParaHoras(totais.PJ || 0), 'var(--verde)')}
        ${cartao('Colaboradores no período', String(itens.length))}
    </div>`;

    if (itens.length === 0) {
        mensagemVazia(canvas, 'Nenhum registro de ponto neste mês.');
        legenda.textContent = '';
        return;
    }

    desenharBarras(canvas, itens);
    legenda.innerHTML = `
        Cada barra usa a métrica do regime do colaborador —
        <b style="color:var(--accent)">CLT: horas extras</b>,
        <b style="color:var(--azul)">estagiário: banco de horas</b>,
        <b style="color:var(--verde)">PJ: horas trabalhadas</b>.
        Escolha uma pessoa no seletor para ver a evolução dia a dia.`;
}

function renderizarIndividual(dados, funcionarioId, canvas, resumo, legenda) {
    const funcionario = funcionariosPorId[funcionarioId];
    const regime = funcionario?.regime || 'CLT';
    const cfg = REGIMES[regime] || REGIMES.CLT;

    const dias = dados
        .filter((d) => d.funcionarioId === funcionarioId)
        .sort((a, b) => a.dataISO.localeCompare(b.dataISO));

    if (dias.length === 0) {
        resumo.innerHTML = '';
        mensagemVazia(canvas, 'Nenhum registro de ponto neste mês para este colaborador.');
        legenda.textContent = cfg.explicacao;
        return;
    }

    let acumulado = 0;
    const pontos = dias.map((d) => {
        const valor = valorDoDia(d, regime);
        acumulado += valor;
        return {
            dataISO: d.dataISO,
            rotulo: d.data,
            rotuloCurto: d.data.substring(0, 5),
            valor,
            acumulado,
            trabalhado: d.trabalhadoMinutos || 0,
            extra: d.horas_extras?.minutos || 0,
            noturno: d.horas_noturnas?.minutos || 0,
            ehFeriado: d.ehFeriado
        };
    });

    // Cartões: o que interessa muda com o regime
    const totalTrabalhado = pontos.reduce((s, p) => s + p.trabalhado, 0);
    const totalExtra = pontos.reduce((s, p) => s + p.extra, 0);
    const totalNoturno = pontos.reduce((s, p) => s + p.noturno, 0);
    const saldoMes = dias.reduce((s, d) => s + (d.saldoMinutos || 0), 0);
    const extra60 = dias.filter((d) => d.horas_extras?.tipo === 'dia_util').reduce((s, d) => s + d.horas_extras.minutos, 0);
    const extra100 = dias.filter((d) => d.horas_extras?.tipo === 'domingo_feriado').reduce((s, d) => s + d.horas_extras.minutos, 0);

    let cartoes;
    if (regime === 'PJ') {
        cartoes = [
            cartao('Horas trabalhadas', minutosParaHoras(totalTrabalhado), 'var(--verde)'),
            cartao('Dias com registro', String(dias.length)),
            cartao('Média por dia', minutosParaHoras(totalTrabalhado / dias.length)),
            cartao('Horas noturnas', minutosParaHoras(totalNoturno), 'var(--azul)')
        ];
    } else if (regime === 'ESTAGIARIO') {
        cartoes = [
            cartao('Saldo do mês', minutosParaHoras(acumulado), acumulado >= 0 ? 'var(--verde)' : 'var(--vermelho)'),
            cartao('Horas trabalhadas', minutosParaHoras(totalTrabalhado)),
            cartao('Dias com registro', String(dias.length)),
            cartao('Horas noturnas', minutosParaHoras(totalNoturno), 'var(--azul)')
        ];
    } else {
        cartoes = [
            cartao('Horas extras', minutosParaHoras(totalExtra), 'var(--accent)'),
            cartao('Extra 60%', minutosParaHoras(extra60)),
            cartao('Extra 100%', minutosParaHoras(extra100), 'var(--amarelo)'),
            cartao('Saldo do mês', minutosParaHoras(saldoMes), saldoMes >= 0 ? 'var(--verde)' : 'var(--vermelho)')
        ];
    }
    resumo.innerHTML = `<div class="cartoes-resumo">${cartoes.join('')}</div>`;

    grafico = criarGraficoArea(canvas, pontos, {
        corLinha: cor(cfg.cor, '#f0821e'),
        permiteNegativo: !cfg.sempreCrescente
    });
    animarGrafico(grafico, canvas);

    legenda.innerHTML = `<b>${escapeHtml(cfg.unidadeAcumulada)}</b> de ${escapeHtml(funcionario?.nome || '')} ao longo do mês.
        ${escapeHtml(cfg.explicacao)} Passe o mouse sobre o gráfico para ver cada dia.`;
}

/* ===================== Interatividade (tooltip) ===================== */

function iniciarInteratividade(canvas) {
    const tooltip = document.getElementById('banco-tooltip');
    if (!tooltip || canvas.dataset.hoverPronto) return;
    canvas.dataset.hoverPronto = '1';

    canvas.addEventListener('mousemove', (ev) => {
        if (!grafico || grafico.pts.length === 0) { tooltip.style.display = 'none'; return; }

        const rect = canvas.getBoundingClientRect();
        const mouseX = ev.clientX - rect.left;

        let maisPerto = 0;
        let menorDist = Infinity;
        grafico.pts.forEach((p, i) => {
            const dist = Math.abs(p.x - mouseX);
            if (dist < menorDist) { menorDist = dist; maisPerto = i; }
        });

        const p = grafico.pts[maisPerto];
        const d = p.dado;
        grafico.desenhar(1, maisPerto);

        const sinal = d.valor > 0 ? '+' : '';
        tooltip.innerHTML = `
            <b>${escapeHtml(d.rotulo)}</b>${d.ehFeriado ? ' · feriado' : ''}<br>
            Acumulado: <b>${minutosParaHoras(d.acumulado)}</b><br>
            No dia: ${sinal}${minutosParaHoras(d.valor)}`;
        tooltip.style.display = 'block';

        const larguraTooltip = tooltip.offsetWidth || 150;
        const x = Math.min(Math.max(p.x + 14, 8), grafico.largura - larguraTooltip - 8);
        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${Math.max(6, p.y - 58)}px`;
    });

    canvas.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
        if (grafico) grafico.desenhar(1, null);
    });
}

export function iniciarBancoHoras() {
    iniciarInteratividade(document.getElementById('grafico-banco-horas'));
}
