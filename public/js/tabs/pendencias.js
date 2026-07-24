import { api } from '../api.js';
import { escapeHtml, primeiroNome } from '../utils.js';
import { comAutorizacao } from '../adminGate.js';

function preencher(ids, html) {
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    });
}

export async function carregarPendencias() {
    const idsPresentes = ['lista-presentes-agora', 'lista-presentes-agora-sub'];
    const idsNaoChegaram = ['lista-nao-chegaram', 'lista-nao-chegaram-sub'];

    preencher(idsPresentes, '<p style="color:var(--texto-mudo); font-size:13px;">Carregando...</p>');
    preencher(idsNaoChegaram, '<p style="color:var(--texto-mudo); font-size:13px;">Carregando...</p>');

    let dados;
    try {
        dados = await comAutorizacao(() => api.pendencias());
    } catch (erro) {
        const msg = erro.message === 'cancelado'
            ? 'Acesso cancelado.'
            : `⚠ Não consegui carregar os dados (${escapeHtml(erro.message)}).`;
        preencher(idsPresentes, `<p style="color:#f87171; font-size:13px;">${msg}</p>`);
        preencher(idsNaoChegaram, `<p style="color:#f87171; font-size:13px;">${msg}</p>`);
        return;
    }

    const htmlPresentes = dados.presentesAgora.length
        ? dados.presentesAgora.map((p) => {
            const cor = p.status === 'Em Almoço' ? '#fbcfe8' : '#22c55e';
            return `<div class="colaborador-linha-gaveta" style="border-left-color:${cor}">
                <span class="info-nome">${escapeHtml(p.emoji)} ${escapeHtml(primeiroNome(p.nome))}</span>
                <div class="info-horarios">
                    <span>${p.status === 'Em Almoço' ? '🥪' : '💼'} <b>${escapeHtml(p.status)}</b></span>
                    <span>Desde: <b>${escapeHtml(p.desde)}</b></span>
                </div>
            </div>`;
        }).join('')
        : '<p style="color:var(--texto-mudo); font-size:13px;">Ninguém em expediente no momento.</p>';

    const htmlNaoChegaram = dados.naoChegaram.length
        ? dados.naoChegaram.map((p) => {
            const cor = p.atrasado ? '#ef4444' : '#f59e0b';
            const texto = p.atrasado ? `⏰ Atrasado — previsto ${escapeHtml(p.horario_combinado)}` : `Previsto para ${escapeHtml(p.horario_combinado)} (ainda no horário)`;
            return `<div class="colaborador-linha-gaveta" style="border-left-color:${cor}">
                <span class="info-nome">${escapeHtml(p.emoji)} ${escapeHtml(primeiroNome(p.nome))}</span>
                <div class="info-horarios"><span>${texto}</span></div>
            </div>`;
        }).join('')
        : '<p style="color:var(--texto-mudo); font-size:13px;">Todo mundo já bateu ponto hoje. ✅</p>';

    preencher(idsPresentes, htmlPresentes);
    preencher(idsNaoChegaram, htmlNaoChegaram);
}
