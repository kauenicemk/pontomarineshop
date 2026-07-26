import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, hojeISO } from '../utils.js';

let cacheAuditoria = [];

/** Nomes técnicos das ações traduzidos para algo que um gestor entende na tela. */
const ROTULOS_ACAO = {
    login_admin: 'Entrou no painel',
    login_admin_falhou: 'Tentativa de login falhou',
    login_totem: 'Totem autorizado',
    login_totem_falhou: 'Senha do totem incorreta',
    criar: 'Cadastrou',
    criar_admin: 'Criou administrador',
    demitir: 'Desligou funcionário',
    readmitir: 'Readmitiu funcionário',
    desativar: 'Desativou funcionário',
    excluir_definitivamente: 'Excluiu funcionário',
    ajuste_manual: 'Ajustou ponto manualmente',
    atualizar_jornada: 'Alterou jornada',
    atualizar_regime: 'Alterou regime',
    atualizar_turno: 'Alterou turno',
    atualizar_regras_almoco: 'Alterou regras de almoço',
    atualizar_dados_cadastrais: 'Alterou dados cadastrais',
    justificar_ausencia: 'Justificou ausência',
    justificar_ausencia_lote: 'Justificou faltas em massa',
    remover_ausencia: 'Removeu justificativa',
    registrar_ferias: 'Registrou férias',
    remover_ferias: 'Removeu férias',
    remover: 'Removeu',
    cadastrar_biometria: 'Cadastrou biometria',
    remover_biometria: 'Removeu biometria',
    confirmar_espelho: 'Confirmou espelho de ponto',
    trocar_senha_totem: 'Trocou a senha do totem',
    atualizar_percentual_hora_extra: 'Alterou percentual de hora extra',
    zerar_dados: 'ZEROU OS DADOS DO SISTEMA'
};

const ACOES_CRITICAS = ['zerar_dados', 'excluir_definitivamente', 'login_admin_falhou', 'login_totem_falhou', 'ajuste_manual'];

function rotuloAcao(acao) {
    return ROTULOS_ACAO[acao] || acao.replace(/_/g, ' ');
}

/** "2026-07-25 14:03:22" (UTC, como o SQLite grava) → horário de Brasília. */
function formatarDataHora(valor) {
    if (!valor) return '—';
    const d = new Date(String(valor).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return valor;
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Transforma o JSON de detalhes em texto curto e legível. */
function resumirDetalhes(json) {
    if (!json) return '';
    let obj;
    try { obj = JSON.parse(json); } catch (_) { return String(json); }
    if (!obj || typeof obj !== 'object') return String(json);

    const partes = Object.entries(obj)
        .filter(([chave, valor]) => valor !== null && valor !== undefined && valor !== '' && !chave.startsWith('admin_'))
        .map(([chave, valor]) => {
            const texto = typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
            return `${chave.replace(/_/g, ' ')}: ${texto.length > 60 ? texto.slice(0, 60) + '…' : texto}`;
        });
    return partes.join(' · ');
}

function filtrosAtuais() {
    const filtros = { limite: 300 };
    const inicio = document.getElementById('auditoria-inicio').value;
    const fim = document.getElementById('auditoria-fim').value;
    const acao = document.getElementById('auditoria-acao').value;
    if (inicio) filtros.inicio = inicio;
    if (fim) filtros.fim = fim;
    if (acao) filtros.acao = acao;
    return filtros;
}

export async function carregarAuditoria() {
    const tbody = document.getElementById('lista-auditoria');
    const totalEl = document.getElementById('auditoria-total');
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--texto-mudo)">Carregando...</td></tr>';

    let resposta;
    try {
        resposta = await api.listarAuditoria(filtrosAtuais());
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--vermelho)">${escapeHtml(e.message)}</td></tr>`;
        return;
    }

    cacheAuditoria = resposta.registros;
    const mostrando = cacheAuditoria.length;
    totalEl.textContent = resposta.total > mostrando
        ? `Mostrando os ${mostrando} registros mais recentes de ${resposta.total} no período.`
        : `${resposta.total} registro(s) no período.`;

    tbody.innerHTML = cacheAuditoria.length
        ? cacheAuditoria.map((r) => {
            const critica = ACOES_CRITICAS.includes(r.acao);
            const quem = r.admin_nome
                ? escapeHtml(r.admin_nome)
                : '<span style="color:var(--texto-mudo)">sistema / totem</span>';
            const alvo = r.entidade + (r.entidade_id ? ` #${r.entidade_id}` : '');
            return `
                <tr>
                    <td style="white-space:nowrap">${escapeHtml(formatarDataHora(r.criado_em))}</td>
                    <td>${quem}</td>
                    <td style="${critica ? 'color:var(--vermelho); font-weight:700' : ''}">${escapeHtml(rotuloAcao(r.acao))}</td>
                    <td style="color:var(--texto-mudo)">${escapeHtml(alvo)}</td>
                    <td style="white-space:normal; max-width:340px; color:var(--texto-mudo); font-size:12px">${escapeHtml(resumirDetalhes(r.detalhes))}</td>
                    <td style="color:var(--texto-mudo); font-size:12px">${escapeHtml(r.ip || '—')}</td>
                </tr>`;
        }).join('')
        : '<tr><td colspan="6" class="texto-vazio">Nenhum registro no período selecionado.</td></tr>';
}

export function exportarAuditoriaCSV() {
    if (cacheAuditoria.length === 0) {
        toast('Não há registros para exportar.', 'erro');
        return;
    }

    let csv = '﻿';
    csv += 'Data/Hora;Quem;Acao;Alvo;Detalhes;IP;Rota\n';
    cacheAuditoria.forEach((r) => {
        const campos = [
            formatarDataHora(r.criado_em),
            r.admin_nome || 'sistema/totem',
            rotuloAcao(r.acao),
            r.entidade + (r.entidade_id ? ` #${r.entidade_id}` : ''),
            resumirDetalhes(r.detalhes),
            r.ip || '',
            r.rota || ''
        ].map((v) => String(v).replace(/;/g, ',').replace(/\r?\n/g, ' '));
        csv += campos.join(';') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Log_Auditoria_${hojeISO()}.csv`;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export async function iniciarAuditoria() {
    const btn = document.getElementById('btn-filtrar-auditoria');
    if (!btn || btn.dataset.iniciado) return;
    btn.dataset.iniciado = '1';

    // Período padrão: últimos 30 dias
    const hoje = hojeISO();
    const trintaDiasAtras = new Date(`${hoje}T12:00:00Z`);
    trintaDiasAtras.setUTCDate(trintaDiasAtras.getUTCDate() - 30);
    document.getElementById('auditoria-inicio').value = trintaDiasAtras.toISOString().slice(0, 10);
    document.getElementById('auditoria-fim').value = hoje;

    btn.addEventListener('click', () => carregarAuditoria());
    document.getElementById('btn-exportar-auditoria')?.addEventListener('click', exportarAuditoriaCSV);

    try {
        const acoes = await api.listarAcoesAuditoria();
        const select = document.getElementById('auditoria-acao');
        select.innerHTML = '<option value="">Todas as ações</option>' +
            acoes.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(rotuloAcao(a))}</option>`).join('');
    } catch (_) { /* filtro de ações é opcional */ }
}
