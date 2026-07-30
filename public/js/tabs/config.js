import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, paraMinutos, minutosParaHoras } from '../utils.js';
import { confirmar } from '../confirmar.js';
import { turnoDoFuncionario, ROTULOS_TURNO, HORA_CORTE_TURNO } from '../turno.js';

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
    container.innerHTML = '<p style="color:var(--texto-mudo); font-size:13px;">Carregando...</p>';

    let funcionarios;
    try {
        funcionarios = await api.listarFuncionariosTodos();
    } catch (e) {
        container.innerHTML = e.message === 'cancelado' ? '' : `<p style="color:var(--vermelho)">${escapeHtml(e.message)}</p>`;
        return;
    }

    container.innerHTML = funcionarios.map((f) => `
        <div class="config-row-funcionario ${f.ativo ? '' : 'inativo'}" data-id="${f.id}" data-turno="${turnoDoFuncionario(f)}" data-regime="${escapeHtml(f.regime)}">
            <button type="button" class="config-gaveta-header" aria-expanded="false">
                <span class="config-gaveta-titulo">
                    <b>${escapeHtml(f.emoji)} ${escapeHtml(f.nome)}</b>
                    ${f.ativo ? '' : ' <span class="badge-desligado">Desligado</span>'}
                </span>
                <span class="config-gaveta-meta">
                    <span class="badge-turno">${escapeHtml(ROTULOS_TURNO[turnoDoFuncionario(f)])}</span>
                    ${escapeHtml(ROTULOS_REGIME[f.regime] || f.regime)}
                    <svg class="icone-svg config-gaveta-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
                </span>
            </button>

            <div class="config-gaveta-corpo escondido">
            <div class="config-row-acoes" style="margin-bottom:12px;">
                ${f.regime === 'ESTAGIARIO' ? '<button class="action-btn btn-efetivar" style="width:auto; padding:6px 12px; margin:0;">Efetivar (virar CLT)</button>' : ''}
                ${f.ativo
                    ? '<button class="action-btn btn-demitir" style="width:auto; padding:6px 12px; margin:0; border-color:var(--borda-perigo); color:var(--vermelho);">Demitir</button>'
                    : '<button class="action-btn btn-readmitir" style="width:auto; padding:6px 12px; margin:0;">Readmitir</button>'}
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
                <label>Data de admissão 
                    <input type="date" class="input-admissao" value="${escapeHtml(f.data_admissao || '')}">
                </label>
                <label>Salário-base (R$) 
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
                <p class="nota-rodape" style="margin:0 0 8px;">
                    O turno é definido sozinho pelo horário de entrada: antes das
                    ${HORA_CORTE_TURNO}:00 é <b>${ROTULOS_TURNO.manha_tarde}</b>, a partir das
                    ${HORA_CORTE_TURNO}:00 é <b>${ROTULOS_TURNO.tarde_noite}</b>.
                </p>
                <button type="button" class="btn-copiar-jornada">Copiar Segunda-feira para Terça–Sexta</button>
                ${GRUPOS.map((g) => linhaGrupo(g, f.jornada[g.chave])).join('')}
            </div>

            <button class="action-btn btn-salvar-linha" style="width:auto; padding:6px 14px; margin-top:10px;">Salvar tudo</button>
            </div>
        </div>
    `).join('');

    renderizarResumoEquipe(funcionarios);

    // Gavetas: cada funcionário abre/fecha ao tocar no cabeçalho (fechadas por padrão).
    iniciarFiltros();
    aplicarFiltros();

    container.querySelectorAll('.config-gaveta-header').forEach((header) => {
        header.addEventListener('click', () => {
            const corpo = header.nextElementSibling;
            const aberto = !corpo.classList.contains('escondido');
            corpo.classList.toggle('escondido');
            header.setAttribute('aria-expanded', String(!aberto));
            header.classList.toggle('aberta', !aberto);
        });
    });

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

/* ===================== Resumo da equipe (painel lateral) ===================== */

/**
 * Composição da equipe + o que falta preencher. As pendências não são enfeite:
 * sem salário-base o sistema não converte hora extra em R$, e sem jornada marcada
 * a pessoa nunca aparece como falta nem como atrasada. Antes isso só se descobria
 * abrindo funcionário por funcionário.
 */
function renderizarResumoEquipe(funcionarios) {
    const alvo = document.getElementById('config-resumo-equipe');
    if (!alvo) return;

    const ativos = funcionarios.filter((f) => f.ativo);
    const porRegime = { CLT: 0, ESTAGIARIO: 0, PJ: 0 };
    const porTurno = { manha_tarde: 0, tarde_noite: 0 };
    ativos.forEach((f) => {
        porRegime[f.regime] = (porRegime[f.regime] || 0) + 1;
        porTurno[turnoDoFuncionario(f)] += 1;
    });

    const temJornada = (f) => Object.values(f.jornada || {}).some((d) => d && d.trabalha);
    const pendencias = [
        { rotulo: 'sem jornada configurada', lista: ativos.filter((f) => !temJornada(f)) },
        { rotulo: 'sem salário-base', lista: ativos.filter((f) => f.salario_base == null) },
        { rotulo: 'sem data de admissão', lista: ativos.filter((f) => !f.data_admissao) }
    ].filter((p) => p.lista.length > 0);

    const linha = (rotulo, valor) => `<div class="resumo-linha"><span>${escapeHtml(rotulo)}</span><b>${valor}</b></div>`;

    alvo.innerHTML = `
        <div class="resumo-titulo">Equipe ativa</div>
        ${linha('Total', ativos.length)}
        ${linha(ROTULOS_REGIME.CLT, porRegime.CLT || 0)}
        ${linha(ROTULOS_REGIME.ESTAGIARIO, porRegime.ESTAGIARIO || 0)}
        ${linha(ROTULOS_REGIME.PJ, porRegime.PJ || 0)}
        ${funcionarios.length > ativos.length ? linha('Desligados', funcionarios.length - ativos.length) : ''}

        <div class="resumo-titulo">Por turno</div>
        ${linha(ROTULOS_TURNO.manha_tarde, porTurno.manha_tarde)}
        ${linha(ROTULOS_TURNO.tarde_noite, porTurno.tarde_noite)}

        <div class="resumo-titulo">Cadastros incompletos</div>
        ${pendencias.length
            ? pendencias.map((p) => `
                <button type="button" class="resumo-pendencia" data-ids="${p.lista.map((f) => f.id).join(',')}">
                    ${p.lista.length} ${escapeHtml(p.rotulo)}
                </button>`).join('')
            : '<p class="nota-rodape" style="margin:6px 0 0;">Tudo preenchido.</p>'}
    `;

    alvo.querySelectorAll('.resumo-pendencia').forEach((btn) => {
        btn.addEventListener('click', () => destacarPendentes(btn.dataset.ids.split(',')));
    });
}

/** Filtra a lista para as pessoas da pendência e abre a gaveta de cada uma. */
function destacarPendentes(ids) {
    const conjunto = new Set(ids);
    document.getElementById('config-busca').value = '';
    document.getElementById('config-turno').value = '';

    document.querySelectorAll('.config-row-funcionario').forEach((linha) => {
        const alvo = conjunto.has(linha.dataset.id);
        linha.classList.toggle('escondido', !alvo);
        const corpo = linha.querySelector('.config-gaveta-corpo');
        const header = linha.querySelector('.config-gaveta-header');
        if (corpo && header) {
            corpo.classList.toggle('escondido', !alvo);
            header.classList.toggle('aberta', alvo);
            header.setAttribute('aria-expanded', String(alvo));
        }
    });

    document.querySelector('.config-row-funcionario:not(.escondido)')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ===================== Filtros da lista (busca + turno) ===================== */

function iniciarFiltros() {
    const busca = document.getElementById('config-busca');
    const turno = document.getElementById('config-turno');
    if (!busca || busca.dataset.iniciado) return;
    busca.dataset.iniciado = '1';
    busca.addEventListener('input', aplicarFiltros);
    turno?.addEventListener('change', aplicarFiltros);
    document.getElementById('config-regime')?.addEventListener('change', aplicarFiltros);
}

function aplicarFiltros() {
    const termo = (document.getElementById('config-busca')?.value || '').trim().toLowerCase();
    const turno = document.getElementById('config-turno')?.value || '';
    const regime = document.getElementById('config-regime')?.value || '';
    const container = document.getElementById('lista-config-horarios');
    let visiveis = 0;

    container.querySelectorAll('.config-row-funcionario').forEach((linha) => {
        const nome = (linha.querySelector('.config-gaveta-titulo b')?.textContent || '').toLowerCase();
        const combina = (!termo || nome.includes(termo))
            && (!turno || linha.dataset.turno === turno)
            && (!regime || linha.dataset.regime === regime);
        linha.classList.toggle('escondido', !combina);
        if (combina) visiveis += 1;
    });

    let vazio = container.querySelector('.filtro-sem-resultado');
    if (visiveis === 0 && !vazio) {
        vazio = document.createElement('p');
        vazio.className = 'texto-vazio filtro-sem-resultado';
        vazio.textContent = 'Nenhum colaborador corresponde ao filtro.';
        container.appendChild(vazio);
    } else if (vazio && visiveis > 0) {
        vazio.remove();
    }
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
        await api.atualizarRegime(id, regime);
        await api.atualizarRegrasAlmoco(id, { tolerancia_almoco_min, almoco_flexivel });
        await api.salvarJornada(id, jornada);
        await api.atualizarDadosCadastrais(id, { data_admissao, salario_base, cargo, departamento });
        toast('Configuração salva com sucesso!', 'sucesso');
        renderizarAbaConfig();
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    }
}

async function efetivar(id) {
    try {
        await api.atualizarRegime(id, 'CLT');
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
        const resp = await api.removerFuncionario(id);
        toast(resp.message, 'sucesso');
        document.dispatchEvent(new CustomEvent('funcionario-cadastrado')); // reaproveita o mesmo evento para recarregar tudo
        renderizarAbaConfig();
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    }
}

async function readmitir(id) {
    try {
        await api.atualizarAtivo(id, true);
        toast('Funcionário readmitido com sucesso!', 'sucesso');
        document.dispatchEvent(new CustomEvent('funcionario-cadastrado'));
        renderizarAbaConfig();
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    }
}
