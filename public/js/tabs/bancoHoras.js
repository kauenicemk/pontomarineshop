import { api } from '../api.js';
import { escapeHtml, mesAtualISO } from '../utils.js';
import { comAutorizacao } from '../adminGate.js';

/**
 * A versão anterior usava Chart.js carregado de um CDN externo (cdnjs.cloudflare.com).
 * Se a rede do local não tiver saída para esse endereço (proxy corporativo, firewall, ambiente
 * offline etc.), a lib nunca carrega e o gráfico simplesmente não aparece — sem erro visível
 * para quem está usando o sistema. Para não depender de nada de fora, o gráfico agora é
 * desenhado à mão em cima do <canvas>, com JS puro.
 */

let ultimoDesenhoIndividual = null; // { pontosXY, labels, valores } -- usado pelo tooltip no hover
let interatividadeIniciada = false;

export function popularSeletorBanco(funcionarios) {
    const sel = document.getElementById('banco-colaborador');
    const valorAtual = sel.value;
    sel.innerHTML = '<option value="__todos__">📊 Visão Geral (Todos)</option>' +
        funcionarios.map((f) => `<option value="${escapeHtml(f.nome)}">${escapeHtml(f.emoji)} ${escapeHtml(f.nome)}</option>`).join('');
    if (valorAtual) sel.value = valorAtual;

    const mesInput = document.getElementById('banco-mes');
    if (!mesInput.value) mesInput.value = mesAtualISO();
}

function saldoParaMinutos(saldoStr) {
    if (!saldoStr || saldoStr === '---') return null;
    const sinal = saldoStr.startsWith('-') ? -1 : 1;
    const limpo = saldoStr.replace('+', '').replace('-', '');
    const [h, m] = limpo.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return sinal * (h * 60 + m);
}

function prepararCanvas(canvas) {
    // Ajusta a resolução real do canvas para o tamanho exibido (evita ficar borrado em telas HiDPI).
    const dpr = window.devicePixelRatio || 1;
    const larguraCss = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const alturaCss = 260;
    canvas.style.height = `${alturaCss}px`;
    canvas.width = larguraCss * dpr;
    canvas.height = alturaCss * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, largura: larguraCss, altura: alturaCss };
}

function corTexto() {
    return getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim() || '#f8fafc';
}
function corMuted() {
    return getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#94a3b8';
}
function corGrade() {
    return getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#334155';
}

function desenharMensagem(ctx, largura, altura, texto) {
    ctx.clearRect(0, 0, largura, altura);
    ctx.fillStyle = corMuted();
    ctx.font = '13px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(texto, largura / 2, altura / 2);
}

/** Gráfico de barras — saldo acumulado no mês, um por colaborador. */
function desenharBarras(ctx, largura, altura, labels, valores) {
    ctx.clearRect(0, 0, largura, altura);
    if (labels.length === 0) return desenharMensagem(ctx, largura, altura, 'Sem dados no período selecionado.');

    const margemEsq = 46, margemDir = 14, margemTopo = 16, margemBase = 30;
    const areaLargura = largura - margemEsq - margemDir;
    const areaAltura = altura - margemTopo - margemBase;

    const maiorAbs = Math.max(1, ...valores.map((v) => Math.abs(v)));
    const escala = (areaAltura / 2) / maiorAbs;
    const zeroY = margemTopo + areaAltura / 2;

    // Linha de zero e grade horizontal leve
    ctx.strokeStyle = corGrade();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margemEsq, zeroY);
    ctx.lineTo(largura - margemDir, zeroY);
    ctx.stroke();

    const larguraBarra = Math.min(46, (areaLargura / labels.length) * 0.6);
    const passo = areaLargura / labels.length;

    ctx.font = '11px Segoe UI, sans-serif';
    ctx.textAlign = 'center';

    labels.forEach((label, i) => {
        const x = margemEsq + passo * i + passo / 2;
        const valor = valores[i];
        const alturaBarra = Math.abs(valor) * escala;
        const y = valor >= 0 ? zeroY - alturaBarra : zeroY;

        ctx.fillStyle = valor >= 0 ? '#4ade80' : '#f87171';
        ctx.fillRect(x - larguraBarra / 2, y, larguraBarra, alturaBarra);

        ctx.fillStyle = corTexto();
        ctx.fillText(`${valor >= 0 ? '+' : ''}${valor}h`, x, valor >= 0 ? y - 6 : y + alturaBarra + 14);

        ctx.fillStyle = corMuted();
        ctx.fillText(label, x, altura - 10);
    });
}

/** Gráfico de linha — evolução do saldo acumulado ao longo do mês, para 1 colaborador. */
function desenharLinha(ctx, largura, altura, labels, valores) {
    ctx.clearRect(0, 0, largura, altura);
    if (labels.length === 0) { desenharMensagem(ctx, largura, altura, 'Sem dados no período selecionado.'); return []; }

    const margemEsq = 46, margemDir = 14, margemTopo = 20, margemBase = 30;
    const areaLargura = largura - margemEsq - margemDir;
    const areaAltura = altura - margemTopo - margemBase;

    const min = Math.min(0, ...valores);
    const max = Math.max(0, ...valores);
    const amplitude = (max - min) || 1;
    const escalaY = areaAltura / amplitude;
    const zeroY = margemTopo + areaAltura - (0 - min) * escalaY;

    ctx.strokeStyle = corGrade();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margemEsq, zeroY);
    ctx.lineTo(largura - margemDir, zeroY);
    ctx.stroke();

    const passo = labels.length > 1 ? areaLargura / (labels.length - 1) : 0;
    const pontosXY = valores.map((v, i) => ({
        x: margemEsq + passo * i,
        y: margemTopo + areaAltura - (v - min) * escalaY
    }));

    // Área preenchida sob a linha
    ctx.beginPath();
    ctx.moveTo(pontosXY[0].x, zeroY);
    pontosXY.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pontosXY[pontosXY.length - 1].x, zeroY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(56,189,248,0.15)';
    ctx.fill();

    // Linha
    ctx.beginPath();
    pontosXY.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pontos
    pontosXY.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = valores[i] >= 0 ? '#4ade80' : '#f87171';
        ctx.fill();
    });

    // Labels do eixo X (mostra só alguns, pra não poluir)
    ctx.fillStyle = corMuted();
    ctx.font = '10.5px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    const passoLabel = Math.max(1, Math.ceil(labels.length / 8));
    labels.forEach((label, i) => {
        if (i % passoLabel === 0 || i === labels.length - 1) {
            ctx.fillText(label, pontosXY[i].x, altura - 10);
        }
    });

    return pontosXY;
}

function calcularResumoIndividual(valoresAcumulados, deltasDiarios) {
    if (valoresAcumulados.length === 0) return null;
    const saldoFinal = valoresAcumulados[valoresAcumulados.length - 1];
    const melhorDelta = Math.max(...deltasDiarios);
    const piorDelta = Math.min(...deltasDiarios);
    const media = deltasDiarios.reduce((a, b) => a + b, 0) / deltasDiarios.length;
    return { saldoFinal, melhorDelta, piorDelta, media };
}

function renderizarResumoIndividual(resumo) {
    const el = document.getElementById('banco-resumo-individual');
    if (!el) return;
    if (!resumo) { el.innerHTML = ''; return; }

    const cor = (v) => (v >= 0 ? '#4ade80' : '#f87171');
    const fmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}h`;

    el.innerHTML = `
        <div class="cartoes-resumo">
            <div class="cartao-resumo"><span class="cartao-resumo-valor" style="color:${cor(resumo.saldoFinal)}">${fmt(resumo.saldoFinal)}</span><span class="cartao-resumo-rotulo">Saldo acumulado</span></div>
            <div class="cartao-resumo"><span class="cartao-resumo-valor" style="color:#4ade80">${fmt(resumo.melhorDelta)}</span><span class="cartao-resumo-rotulo">Melhor dia</span></div>
            <div class="cartao-resumo"><span class="cartao-resumo-valor" style="color:#f87171">${fmt(resumo.piorDelta)}</span><span class="cartao-resumo-rotulo">Pior dia</span></div>
            <div class="cartao-resumo"><span class="cartao-resumo-valor" style="color:${cor(resumo.media)}">${fmt(resumo.media)}</span><span class="cartao-resumo-rotulo">Média por dia</span></div>
        </div>`;
}

/** Tooltip no hover — só liga uma vez; usa `ultimoDesenhoIndividual` (atualizado a cada render) pra saber onde estão os pontos. */
function iniciarInteratividade(canvas) {
    if (interatividadeIniciada) return;
    interatividadeIniciada = true;

    const tooltip = document.getElementById('banco-tooltip');
    if (!tooltip) return;

    canvas.addEventListener('mousemove', (ev) => {
        if (!ultimoDesenhoIndividual || ultimoDesenhoIndividual.pontosXY.length === 0) { tooltip.style.display = 'none'; return; }

        const rect = canvas.getBoundingClientRect();
        const mouseX = ev.clientX - rect.left;

        let maisPerto = 0;
        let menorDist = Infinity;
        ultimoDesenhoIndividual.pontosXY.forEach((p, i) => {
            const dist = Math.abs(p.x - mouseX);
            if (dist < menorDist) { menorDist = dist; maisPerto = i; }
        });

        const p = ultimoDesenhoIndividual.pontosXY[maisPerto];
        const valor = ultimoDesenhoIndividual.valores[maisPerto];
        const label = ultimoDesenhoIndividual.labels[maisPerto];

        tooltip.textContent = `${label}: ${valor >= 0 ? '+' : ''}${valor}h`;
        tooltip.style.display = 'block';
        tooltip.style.left = `${p.x + 12}px`;
        tooltip.style.top = `${Math.max(0, p.y - 28)}px`;
    });

    canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
}

export async function renderizarGraficoBanco() {
    const canvas = document.getElementById('grafico-banco-horas');
    const legenda = document.getElementById('banco-horas-legenda');
    const { ctx, largura, altura } = prepararCanvas(canvas);
    desenharMensagem(ctx, largura, altura, 'Carregando...');
    iniciarInteratividade(canvas);

    const mesSelecionado = document.getElementById('banco-mes').value; // yyyy-mm
    const colaboradorSelecionado = document.getElementById('banco-colaborador').value;

    let dados;
    try {
        const inicio = mesSelecionado ? `${mesSelecionado}-01` : undefined;
        const fim = mesSelecionado ? `${mesSelecionado}-31` : undefined;
        dados = await comAutorizacao(() => api.relatorioCalculado(inicio, fim));
    } catch (e) {
        if (e.message !== 'cancelado') desenharMensagem(ctx, largura, altura, 'Não foi possível carregar os dados.');
        return;
    }

    if (colaboradorSelecionado === '__todos__') {
        ultimoDesenhoIndividual = null;
        renderizarResumoIndividual(null);

        const totais = {};
        dados.forEach((d) => {
            const min = saldoParaMinutos(d.saldo);
            if (min === null) return;
            totais[d.nome] = (totais[d.nome] || 0) + min;
        });
        const nomes = Object.keys(totais).sort();
        const valores = nomes.map((n) => +(totais[n] / 60).toFixed(2));

        desenharBarras(ctx, largura, altura, nomes.map((n) => n.split(' ')[0]), valores);
        legenda.textContent = 'Saldo acumulado no mês, por colaborador (verde = positivo, vermelho = negativo). Passe o mouse na visão individual para ver o valor exato de cada dia.';
    } else {
        const registrosColab = dados.filter((d) => d.nome === colaboradorSelecionado).sort((a, b) => a.dataISO.localeCompare(b.dataISO));
        let acumulado = 0;
        const labels = []; const valores = []; const deltasDiarios = [];
        registrosColab.forEach((d) => {
            const min = saldoParaMinutos(d.saldo);
            if (min === null) return;
            acumulado += min;
            labels.push(d.data.substring(0, 5));
            valores.push(+(acumulado / 60).toFixed(2));
            deltasDiarios.push(+(min / 60).toFixed(2));
        });

        const pontosXY = desenharLinha(ctx, largura, altura, labels, valores);
        ultimoDesenhoIndividual = { pontosXY, labels, valores };
        renderizarResumoIndividual(calcularResumoIndividual(valores, deltasDiarios));
        legenda.textContent = `Saldo acumulado ao longo do mês — ${colaboradorSelecionado.split(' ')[0]}. Passe o mouse sobre o gráfico pra ver o valor de cada dia.`;
    }
}
