import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../utils.js';
import { confirmar } from '../confirmar.js';

/**
 * Correção de ponto de um dia específico. Substitui o antigo "ajuste manual", que só
 * sabia INSERIR — se alguém batesse o ponto errado, não havia como apagar nem corrigir,
 * e o relatório passava a considerar a última batida do tipo. Aqui o administrador vê
 * exatamente o que está gravado naquele dia e conserta.
 */

const TIPOS = ['Entrada', 'Saída Almoço', 'Retorno Almoço', 'Saída Final'];

let contexto = { funcionarioId: null, data: null, nome: '' };

function linhaRegistro(r) {
    const hora = (r.hora || '').substring(0, 5);
    return `
        <tr data-id="${r.id}">
            <td><b>${escapeHtml(r.tipo)}</b></td>
            <td><input type="time" class="campo campo-hora-registro" value="${escapeHtml(hora)}" style="width:120px;"></td>
            <td>${r.ajuste_manual
                ? `<span class="badge-manual" title="${escapeHtml(r.justificativa || 'Ajustado manualmente')}">Ajuste manual</span>`
                : '<span style="color:var(--texto-mudo)">Batido no totem</span>'}</td>
            <td style="white-space:normal; color:var(--texto-mudo); font-size:12px;">${escapeHtml(r.justificativa || '—')}</td>
            <td>
                <div class="config-row-acoes">
                    <button class="action-btn btn-salvar-hora">Salvar hora</button>
                    <button class="action-btn btn-apagar-registro" style="border-color:rgba(242,84,91,.4); color:var(--vermelho);">Apagar</button>
                </div>
            </td>
        </tr>`;
}

function tiposFaltando(registros) {
    const existentes = new Set(registros.map((r) => r.tipo));
    return TIPOS.filter((t) => !existentes.has(t));
}

function renderizar(dados) {
    const container = document.getElementById('editor-pontos');
    const faltando = tiposFaltando(dados.registros);
    const dataBR = dados.data.split('-').reverse().join('/');

    container.innerHTML = `
        <div class="cabecalho-editor">
            <span><b>${escapeHtml(dados.funcionario.emoji || '')} ${escapeHtml(dados.funcionario.nome)}</b> — ${escapeHtml(dataBR)}</span>
            <span class="nota-rodape" style="margin:0">${dados.registros.length} batida(s) neste dia</span>
        </div>

        ${dados.registros.length ? `
            <div class="tabela-wrap">
                <table>
                    <thead><tr><th>Tipo</th><th>Hora</th><th>Origem</th><th>Justificativa</th><th></th></tr></thead>
                    <tbody id="corpo-editor-pontos">${dados.registros.map(linhaRegistro).join('')}</tbody>
                </table>
            </div>`
        : '<p class="texto-vazio">Nenhuma batida registrada neste dia.</p>'}

        ${faltando.length ? `
            <div class="bloco-adicionar">
                <h3 style="margin:0 0 10px;">Lançar batida que faltou</h3>
                <div class="filtros" style="margin-bottom:0;">
                    <label>Tipo
                        <select id="novo-ponto-tipo">
                            ${faltando.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
                        </select>
                    </label>
                    <label>Hora <input type="time" id="novo-ponto-hora"></label>
                    <label style="flex:1; min-width:200px;">Justificativa
                        <input type="text" class="campo" id="novo-ponto-justificativa" placeholder="Ex: esqueceu de bater na saída">
                    </label>
                    <button class="btn btn-principal" id="btn-adicionar-ponto" style="margin:0;">Lançar</button>
                </div>
            </div>`
        : '<p class="nota-rodape">Os quatro registros do dia já estão lançados.</p>'}
    `;

    container.querySelectorAll('.btn-salvar-hora').forEach((btn) => {
        btn.addEventListener('click', () => salvarHora(btn.closest('tr')));
    });
    container.querySelectorAll('.btn-apagar-registro').forEach((btn) => {
        btn.addEventListener('click', () => apagarRegistro(btn.closest('tr')));
    });
    document.getElementById('btn-adicionar-ponto')?.addEventListener('click', adicionarPonto);
}

export async function carregarPontosDoDia() {
    const select = document.getElementById('select-f-ajuste');
    const funcionarioId = select.value;
    const data = document.getElementById('ajuste-data').value;
    const container = document.getElementById('editor-pontos');

    if (!funcionarioId || !data) {
        toast('Escolha o funcionário e a data.', 'erro');
        return;
    }

    contexto = { funcionarioId, data, nome: select.selectedOptions[0]?.textContent || '' };
    container.innerHTML = '<p class="texto-vazio">Carregando batidas...</p>';

    try {
        renderizar(await api.pontosDoDia(funcionarioId, data));
    } catch (e) {
        container.innerHTML = `<p style="color:var(--vermelho)">${escapeHtml(e.message)}</p>`;
    }
}

async function salvarHora(linha) {
    const id = linha.dataset.id;
    const hora = linha.querySelector('.campo-hora-registro').value;
    if (!hora) {
        toast('Informe o horário.', 'erro');
        return;
    }

    const justificativa = await pedirJustificativa(
        'Corrigir horário',
        `O registro passará a valer para as ${hora}. Explique o motivo — a correção fica no log de auditoria.`
    );
    if (justificativa === null) return;

    try {
        await api.editarPonto(id, { hora, justificativa });
        toast('Horário corrigido.', 'sucesso');
        carregarPontosDoDia();
        document.dispatchEvent(new CustomEvent('ponto-alterado'));
    } catch (e) {
        toast(e.message, 'erro');
    }
}

async function apagarRegistro(linha) {
    const id = linha.dataset.id;
    const tipo = linha.querySelector('td b').textContent;
    const hora = linha.querySelector('.campo-hora-registro').value;

    const justificativa = await pedirJustificativa(
        `Apagar "${tipo}" das ${hora}?`,
        'A batida some do histórico e dos relatórios. O registro apagado fica guardado no log de auditoria.',
        { perigo: true, textoConfirmar: 'Apagar registro' }
    );
    if (justificativa === null) return;

    try {
        await api.removerPonto(id, justificativa);
        toast('Registro apagado.', 'sucesso');
        carregarPontosDoDia();
        document.dispatchEvent(new CustomEvent('ponto-alterado'));
    } catch (e) {
        toast(e.message, 'erro');
    }
}

async function adicionarPonto() {
    const tipo = document.getElementById('novo-ponto-tipo').value;
    const hora = document.getElementById('novo-ponto-hora').value;
    const justificativa = document.getElementById('novo-ponto-justificativa').value.trim();

    if (!hora) { toast('Informe o horário da batida.', 'erro'); return; }
    if (!justificativa) { toast('A justificativa é obrigatória para lançar um ponto manualmente.', 'erro'); return; }

    try {
        await api.ajustarPonto({ funcionario_id: contexto.funcionarioId, data: contexto.data, hora, tipo, justificativa });
        toast('Batida lançada.', 'sucesso');
        carregarPontosDoDia();
        document.dispatchEvent(new CustomEvent('ponto-alterado'));
    } catch (e) {
        toast(e.message, 'erro');
    }
}

/**
 * Confirmação que também coleta a justificativa. Devolve o texto, ou null se
 * o usuário cancelou. A justificativa é obrigatória em toda alteração de ponto.
 */
function pedirJustificativa(titulo, texto, { perigo = false, textoConfirmar = 'Confirmar' } = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modalJustificarPonto');
        const campo = document.getElementById('justificativa-ponto-texto');
        const erro = document.getElementById('justificativa-ponto-erro');
        const btnOk = document.getElementById('btn-confirmar-justificativa-ponto');
        const btnCancelar = document.getElementById('btn-cancelar-justificativa-ponto');

        document.getElementById('justificativa-ponto-titulo').textContent = titulo;
        document.getElementById('justificativa-ponto-info').textContent = texto;
        btnOk.textContent = textoConfirmar;
        btnOk.className = perigo ? 'btn btn-perigo-solido' : 'btn btn-principal';
        campo.value = '';
        erro.textContent = '';
        modal.style.display = 'flex';
        campo.focus();

        function fechar(resultado) {
            modal.style.display = 'none';
            btnOk.removeEventListener('click', aoConfirmar);
            btnCancelar.removeEventListener('click', aoCancelar);
            document.removeEventListener('keydown', aoTeclar);
            resolve(resultado);
        }
        function aoConfirmar() {
            const valor = campo.value.trim();
            if (!valor) { erro.textContent = 'Escreva o motivo da alteração.'; campo.focus(); return; }
            fechar(valor);
        }
        function aoCancelar() { fechar(null); }
        function aoTeclar(ev) { if (ev.key === 'Escape') fechar(null); }

        btnOk.addEventListener('click', aoConfirmar);
        btnCancelar.addEventListener('click', aoCancelar);
        document.addEventListener('keydown', aoTeclar);
    });
}

export function iniciarEditorPontos() {
    const btn = document.getElementById('btn-carregar-pontos');
    if (!btn || btn.dataset.iniciado) return;
    btn.dataset.iniciado = '1';
    btn.addEventListener('click', carregarPontosDoDia);
    document.getElementById('select-f-ajuste')?.addEventListener('change', () => {
        document.getElementById('editor-pontos').innerHTML = '';
    });
}
