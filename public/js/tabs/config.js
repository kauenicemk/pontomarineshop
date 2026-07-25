import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, paraMinutos, minutosParaHoras } from '../utils.js';
import { comAutorizacao } from '../adminGate.js';
import { confirmar } from '../confirmar.js';

const ROTULOS_REGIME = { CLT: 'CLT', ESTAGIARIO: 'Estagiário', PJ: 'PJ' };
const GRUPOS = [
    { chave: 'segunda', rotulo: 'Segunda-feira' },
    { chave: 'terca', rotulo: 'Terça-feira' },
    { chave: 'quarta', rotulo: 'Quarta-feira' },
    { chave: 'quinta', rotulo: 'Quinta-feira' },
    { chave: 'sexta', rotulo: 'Sexta-feira' },
    { chave: 'sabado', rotulo: 'Sábado' }
];

function linhaGrupo(grupo, cfg) {
    const c = cfg || { horario_entrada: '08:00', meta_minutos: 0, trabalha: false };
    return `
        <div class="jornada-grupo" data-grupo="${grupo.chave}">
            <span class="jornada-rotulo">${grupo.rotulo}</span>
            <label class="label-checkbox">
                <input type="checkbox" class="jornada-trabalha" ${c.trabalha ? 'checked' : ''}>
                Trabalha
            </label>
            <label>Entrada
                <input type="time" class="jornada-entrada" value="${escapeHtml(c.horario_entrada)}">
            </label>
            <label>Carga horária
                <input type="text" class="jornada-carga" value="${escapeHtml(minutosParaHoras(c.meta_minutos))}" placeholder="08:00" style="width:60px">
            </label>
        </div>
    `;
}

export async function renderizarAbaConfig() {
    const container = document.getElementById('lista-config-horarios');
    container.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';

    let funcionarios;
    try {
        funcionarios = await comAutorizacao(() => api.listarFuncionariosTodos());
    } catch (e) {
        container.innerHTML = e.message === 'cancelado' ? '' : `<p style="color:#f87171">${escapeHtml(e.message)}</p>`;
        return;
    }

    container.innerHTML = funcionarios.map((f) => `
        <div class="config-row-funcionario ${f.ativo ? '' : 'inativo'}" data-id="${f.id}">
            <div class="config-row-cabecalho">
                <span>
                    <b>${escapeHtml(f.emoji)} ${escapeHtml(f.nome)}</b>
                    ${f.ativo ? '' : ' <span class="badge-desligado">Desligado</span>'}
                </span>
                <div class="config-row-acoes">
                    ${f.regime === 'ESTAGIARIO' ? '<button class="action-btn btn-efetivar" style="width:auto; padding:6px 12px; margin:0; background:var(--verde);">🎓 Efetivar (virar CLT)</button>' : ''}
                    ${f.ativo
                        ? '<button class="action-btn btn-demitir" style="width:auto; padding:6px 12px; margin:0; background:var(--vermelho);">🗑️ Demitir</button>'
                        : '<button class="action-btn btn-readmitir" style="width:auto; padding:6px 12px; margin:0;">↩️ Readmitir</button>'}
                </div>
            </div>

            <div class="config-row-campos">
                <label>Regime
                    <select class="input-regime">
                        ${Object.keys(ROTULOS_REGIME).map((r) => `<option value="${r}" ${r === f.regime ? 'selected' : ''}>${ROTULOS_REGIME[r]}</option>`).join('')}
                    </select>
                </label>
                <label>Tolerância almoço (min)
                    <input type="number" min="0" max="240" class="input-tolerancia" value="${f.tolerancia_almoco_min}" style="width:70px">
                </label>
                <label class="label-checkbox">
                    <input type="checkbox" class="input-flexivel" ${f.almoco_flexivel ? 'checked' : ''}>
                    Almoço livre (sem gerar atraso)
                </label>
            </div>

            <div class="config-row-campos">
                <label>Data de admissão <span title="Usada para calcular os períodos de férias">ℹ️</span>
                    <input type="date" class="input-admissao" value="${escapeHtml(f.data_admissao || '')}">
                </label>
                <label>Salário-base (R$) <span title="Usado para converter hora extra/noturno de % em R$">ℹ️</span>
                    <input type="number" min="0" step="0.01" class="input-salario" value="${f.salario_base ?? ''}" placeholder="opcional" style="width:100px">
                </label>
                <label>Cargo
                    <input type="text" class="input-cargo" value="${escapeHtml(f.cargo || '')}" placeholder="opcional" style="width:120px">
                </label>
                <label>Departamento
                    <input type="text" class="input-departamento" value="${escapeHtml(f.departamento || '')}" placeholder="opcional" style="width:120px">
                </label>
            </div>

            <div class="jornada-grupos">
                <button type="button" class="btn-copiar-jornada">📋 Copiar Segunda-feira para Terça–Sexta</button>
                ${GRUPOS.map((g) => linhaGrupo(g, f.jornada[g.chave])).join('')}
            </div>

            <button class="action-btn btn-salvar-linha" style="width:auto; padding:6px 14px; margin-top:10px;">Salvar tudo</button>
        </div>
    `).join('');

    container.querySelectorAll('.btn-salvar-linha').forEach((btn) => {
        btn.addEventListener('click', (ev) => salvarLinha(ev.target.closest('.config-row-funcionario')));
    });
    container.querySelectorAll('.btn-efetivar').forEach((btn) => {
        btn.addEventListener('click', (ev) => efetivar(ev.target.closest('.config-row-funcionario').dataset.id));
    });
    container.querySelectorAll('.btn-demitir').forEach((btn) => {
        btn.addEventListener('click', (ev) => demitir(ev.target.closest('.config-row-funcionario')));
    });
    container.querySelectorAll('.btn-readmitir').forEach((btn) => {
        btn.addEventListener('click', (ev) => readmitir(ev.target.closest('.config-row-funcionario').dataset.id));
    });
    container.querySelectorAll('.btn-copiar-jornada').forEach((btn) => {
        btn.addEventListener('click', (ev) => copiarSegundaParaOutrosDias(ev.target.closest('.config-row-funcionario')));
    });
}

/** Copia entrada/carga/trabalha da segunda-feira para terça, quarta, quinta e sexta — sábado fica de fora de propósito. */
function copiarSegundaParaOutrosDias(linha) {
    const blocoSegunda = linha.querySelector('.jornada-grupo[data-grupo="segunda"]');
    const trabalha = blocoSegunda.querySelector('.jornada-trabalha').checked;
    const entrada = blocoSegunda.querySelector('.jornada-entrada').value;
    const carga = blocoSegunda.querySelector('.jornada-carga').value;

    ['terca', 'quarta', 'quinta', 'sexta'].forEach((grupo) => {
        const bloco = linha.querySelector(`.jornada-grupo[data-grupo="${grupo}"]`);
        bloco.querySelector('.jornada-trabalha').checked = trabalha;
        bloco.querySelector('.jornada-entrada').value = entrada;
        bloco.querySelector('.jornada-carga').value = carga;
    });

    toast('Copiado! Clique em "Salvar tudo" para confirmar.', 'info');
}

function lerJornadaDaLinha(linha) {
    const jornada = {};
    linha.querySelectorAll('.jornada-grupo').forEach((bloco) => {
        const grupo = bloco.dataset.grupo;
        jornada[grupo] = {
            trabalha: bloco.querySelector('.jornada-trabalha').checked,
            horario_entrada: bloco.querySelector('.jornada-entrada').value || '08:00',
            meta_minutos: paraMinutos(bloco.querySelector('.jornada-carga').value || '00:00')
        };
    });
    return jornada;
}

async function salvarLinha(linha) {
    const id = linha.dataset.id;
    const regime = linha.querySelector('.input-regime').value;
    const tolerancia_almoco_min = parseInt(linha.querySelector('.input-tolerancia').value, 10) || 0;
    const almoco_flexivel = linha.querySelector('.input-flexivel').checked;
    const jornada = lerJornadaDaLinha(linha);

    const data_admissao = linha.querySelector('.input-admissao').value || null;
    const salario_base = linha.querySelector('.input-salario').value || null;
    const cargo = linha.querySelector('.input-cargo').value.trim() || null;
    const departamento = linha.querySelector('.input-departamento').value.trim() || null;

    try {
        await comAutorizacao(async () => {
            await api.atualizarRegime(id, regime);
            await api.atualizarRegrasAlmoco(id, { tolerancia_almoco_min, almoco_flexivel });
            await api.salvarJornada(id, jornada);
            await api.atualizarDadosCadastrais(id, { data_admissao, salario_base, cargo, departamento });
        });
        toast('Configuração salva com sucesso!', 'sucesso');
        renderizarAbaConfig();
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    }
}

async function efetivar(id) {
    try {
        await comAutorizacao(() => api.atualizarRegime(id, 'CLT'));
        toast('Estagiário efetivado como CLT!', 'sucesso');
        renderizarAbaConfig();
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    }
}

async function demitir(linha) {
    const id = linha.dataset.id;
    const nome = linha.querySelector('b').textContent;
    const ok = await confirmar(
        `Desligar ${nome}?`,
        'Se ele nunca bateu ponto, o cadastro é apagado. Se já tem histórico, o cadastro só é desativado (o histórico é mantido).',
        { textoConfirmar: 'Desligar', perigo: true }
    );
    if (!ok) return;
    try {
        const resp = await comAutorizacao(() => api.removerFuncionario(id));
        toast(resp.message, 'sucesso');
        document.dispatchEvent(new CustomEvent('funcionario-cadastrado')); // reaproveita o mesmo evento para recarregar tudo
        renderizarAbaConfig();
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    }
}

async function readmitir(id) {
    try {
        await comAutorizacao(() => api.atualizarAtivo(id, true));
        toast('Funcionário readmitido com sucesso!', 'sucesso');
        document.dispatchEvent(new CustomEvent('funcionario-cadastrado'));
        renderizarAbaConfig();
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    }
}
