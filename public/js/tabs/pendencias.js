import { api } from '../api.js';
import { escapeHtml, primeiroNome } from '../utils.js';

/**
 * Painel "situação agora": mostra TODO o time classificado — quem está trabalhando,
 * quem está em intervalo, quem está atrasado (e há quantos minutos), quem ainda está
 * dentro do horário, quem já encerrou, quem tem ausência justificada e quem está de
 * folga hoje. O dashboard reaproveita os mesmos dados nos cartões do topo.
 */

const ROTULOS_AUSENCIA = {
    atestado: 'Atestado médico',
    ferias: 'Férias',
    licenca: 'Licença',
    folga: 'Folga',
    sem_justificativa: 'Falta confirmada'
};

/** "95" → "1h35" | "40" → "40min" */
function duracao(minutos) {
    if (!minutos || minutos < 1) return 'agora há pouco';
    if (minutos < 60) return `${minutos}min`;
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

function inicial(nome) {
    return (nome || '?').trim().charAt(0).toUpperCase();
}

/**
 * Uma linha de pessoa. `cor` pinta a faixa lateral e o avatar;
 * `destaque` é o texto forte à direita (horário, atraso...).
 */
function linhaPessoa({ nome, emoji, cor, titulo, detalhe, destaque, destaqueRotulo, urgente }) {
    return `
        <div class="linha-pessoa ${urgente ? 'urgente' : ''}" style="--cor-linha: var(--${cor})">
            <span class="avatar-pessoa" aria-hidden="true">${emoji ? escapeHtml(emoji) : escapeHtml(inicial(nome))}</span>
            <span class="pessoa-textos">
                <span class="pessoa-nome">${escapeHtml(primeiroNome(nome))}</span>
                <span class="pessoa-detalhe">${detalhe}</span>
            </span>
            <span class="pessoa-direita">
                ${destaque ? `<span class="pessoa-destaque">${escapeHtml(destaque)}</span>` : ''}
                ${destaqueRotulo ? `<span class="pessoa-destaque-rotulo">${escapeHtml(destaqueRotulo)}</span>` : ''}
            </span>
        </div>`;
}

function bloco({ titulo, cor, itens, vazio, aberto = true }) {
    if (itens.length === 0 && !vazio) return '';
    return `
        <div class="card bloco-pendencia">
            <div class="bloco-cabecalho">
                <h2><span class="ponto-status ${cor}" aria-hidden="true"></span>${escapeHtml(titulo)}</h2>
                <span class="bloco-contador">${itens.length}</span>
            </div>
            ${itens.length ? itens.join('') : `<p class="texto-vazio">${escapeHtml(vazio)}</p>`}
        </div>`;
}

function cartaoResumo(valor, rotulo, cor) {
    return `
        <div class="cartao-pendencia cor-${cor}">
            <span class="cartao-pendencia-valor">${valor}</span>
            <span class="cartao-pendencia-rotulo">${escapeHtml(rotulo)}</span>
        </div>`;
}

function renderizar(d) {
    const relogio = document.getElementById('pendencias-relogio');
    if (relogio) relogio.textContent = d.horaAtual || '--:--';

    const trabalhando = d.presentesAgora.filter((p) => p.status !== 'Em Almoço');
    const emIntervalo = d.presentesAgora.filter((p) => p.status === 'Em Almoço');
    const atrasados = d.naoChegaram.filter((p) => p.atrasado);
    const aguardando = d.naoChegaram.filter((p) => !p.atrasado);

    const sub = document.getElementById('pendencias-subtitulo');
    if (sub) {
        sub.textContent = atrasados.length
            ? `${atrasados.length} colaborador(es) atrasado(s) neste momento`
            : 'Nenhum atraso no momento — atualiza sozinho a cada 30 segundos';
    }

    document.getElementById('pendencias-resumo').innerHTML = [
        cartaoResumo(trabalhando.length, 'Trabalhando', 'verde'),
        cartaoResumo(emIntervalo.length, 'Em intervalo', 'amarelo'),
        cartaoResumo(atrasados.length, 'Atrasados', atrasados.length ? 'vermelho' : 'verde'),
        cartaoResumo(aguardando.length, 'Aguardando entrada', 'azul'),
        cartaoResumo(d.encerraram.length, 'Encerraram', 'ouro'),
        cartaoResumo(d.ausentesHoje.length, 'Ausências justificadas', 'azul')
    ].join('');

    const blocos = [];

    // Atrasados primeiro — é o que o gestor precisa ver imediatamente
    blocos.push(bloco({
        titulo: 'Atrasados',
        cor: 'vermelho',
        vazio: 'Nenhum atraso no momento.',
        itens: atrasados.map((p) => linhaPessoa({
            nome: p.nome, emoji: p.emoji, cor: 'vermelho', urgente: true,
            detalhe: `Previsto para <b>${escapeHtml(p.horario_combinado || '--:--')}</b> · ainda não bateu ponto`,
            destaque: duracao(p.minutosAtraso),
            destaqueRotulo: 'de atraso'
        }))
    }));

    blocos.push(bloco({
        titulo: 'Em expediente',
        cor: 'verde',
        vazio: 'Ninguém em expediente no momento.',
        itens: trabalhando.map((p) => linhaPessoa({
            nome: p.nome, emoji: p.emoji, cor: 'verde',
            detalhe: `Entrou às <b>${escapeHtml(p.entrada || p.desde)}</b>${p.chegouAtrasado ? ` · <span class="marca-atraso">chegou ${duracao(p.minutosAtrasoEntrada)} atrasado</span>` : ''}`,
            destaque: duracao(p.minutosDesde),
            destaqueRotulo: 'no posto'
        }))
    }));

    if (emIntervalo.length) {
        blocos.push(bloco({
            titulo: 'Em intervalo',
            cor: 'amarelo',
            itens: emIntervalo.map((p) => linhaPessoa({
                nome: p.nome, emoji: p.emoji, cor: 'amarelo',
                detalhe: `Saiu para o almoço às <b>${escapeHtml(p.desde)}</b>`,
                destaque: duracao(p.minutosDesde),
                destaqueRotulo: 'fora'
            }))
        }));
    }

    if (aguardando.length) {
        blocos.push(bloco({
            titulo: 'Aguardando entrada',
            cor: 'amarelo',
            itens: aguardando.map((p) => linhaPessoa({
                nome: p.nome, emoji: p.emoji, cor: 'azul',
                detalhe: `Entrada prevista para <b>${escapeHtml(p.horario_combinado || '--:--')}</b> · ainda dentro do horário`,
                destaque: p.minutosParaEntrada > 0 ? `em ${duracao(p.minutosParaEntrada)}` : 'agora',
                destaqueRotulo: ''
            }))
        }));
    }

    if (d.encerraram.length) {
        blocos.push(bloco({
            titulo: 'Encerraram o expediente',
            cor: 'amarelo',
            itens: d.encerraram.map((p) => linhaPessoa({
                nome: p.nome, emoji: p.emoji, cor: 'ouro',
                detalhe: `Das <b>${escapeHtml(p.entrada)}</b> às <b>${escapeHtml(p.saida)}</b>`,
                destaque: p.saida,
                destaqueRotulo: 'saída'
            }))
        }));
    }

    if (d.ausentesHoje.length) {
        blocos.push(bloco({
            titulo: 'Ausências justificadas',
            cor: 'amarelo',
            itens: d.ausentesHoje.map((p) => linhaPessoa({
                nome: p.nome, emoji: p.emoji, cor: 'azul',
                detalhe: p.justificativa ? escapeHtml(p.justificativa) : 'Sem observação registrada',
                destaque: ROTULOS_AUSENCIA[p.tipo] || p.tipo,
                destaqueRotulo: ''
            }))
        }));
    }

    if (d.semExpediente.length) {
        blocos.push(bloco({
            titulo: 'Sem expediente hoje',
            cor: 'amarelo',
            itens: d.semExpediente.map((p) => linhaPessoa({
                nome: p.nome, emoji: p.emoji, cor: 'texto-mudo',
                detalhe: 'Hoje não é dia de trabalho na escala desta pessoa',
                destaque: '', destaqueRotulo: ''
            }))
        }));
    }

    document.getElementById('pendencias-conteudo').innerHTML = blocos.join('');
}

/* ===================== Dashboard (listas resumidas na tela inicial) ===================== */

export function renderizarResumoDashboard(d) {
    const presentes = document.getElementById('lista-presentes-agora');
    const intervalo = document.getElementById('lista-em-intervalo');
    const naoChegaram = document.getElementById('lista-nao-chegaram');
    if (!presentes || !intervalo || !naoChegaram) return;

    // Quem está em intervalo tem uma lista própria: misturado com quem está no posto,
    // o gestor lia "13 em expediente" e via gente almoçando no meio da lista.
    const trabalhando = d.presentesAgora.filter((p) => p.status !== 'Em Almoço');
    const emIntervalo = d.presentesAgora.filter((p) => p.status === 'Em Almoço');

    const contador = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    };
    contador('contador-em-expediente', trabalhando.length);
    contador('contador-em-intervalo', emIntervalo.length);
    contador('contador-nao-chegaram', d.naoChegaram.length);

    presentes.innerHTML = trabalhando.length
        ? trabalhando.map((p) => linhaPessoa({
            nome: p.nome, emoji: p.emoji, cor: 'verde',
            detalhe: `Entrou às <b>${escapeHtml(p.entrada || p.desde)}</b>${p.chegouAtrasado ? ` · <span class="marca-atraso">chegou ${duracao(p.minutosAtrasoEntrada)} atrasado</span>` : ''}`,
            destaque: duracao(p.minutosDesde), destaqueRotulo: 'no posto'
        })).join('')
        : '<p class="texto-vazio">Ninguém no posto no momento.</p>';

    intervalo.innerHTML = emIntervalo.length
        ? emIntervalo.map((p) => linhaPessoa({
            nome: p.nome, emoji: p.emoji, cor: 'amarelo',
            detalhe: `Saiu para o almoço às <b>${escapeHtml(p.desde)}</b>`,
            destaque: duracao(p.minutosDesde), destaqueRotulo: 'fora'
        })).join('')
        : '<p class="texto-vazio">Ninguém em intervalo agora.</p>';

    naoChegaram.innerHTML = d.naoChegaram.length
        ? d.naoChegaram.map((p) => linhaPessoa({
            nome: p.nome, emoji: p.emoji,
            cor: p.atrasado ? 'vermelho' : 'azul',
            urgente: p.atrasado,
            detalhe: `Previsto para <b>${escapeHtml(p.horario_combinado || '--:--')}</b>`,
            destaque: p.atrasado ? duracao(p.minutosAtraso) : 'no horário',
            destaqueRotulo: p.atrasado ? 'de atraso' : ''
        })).join('')
        : '<p class="texto-vazio">Todo mundo que trabalha hoje já bateu ponto.</p>';
}

/* ===================== Carregamento ===================== */

export async function carregarPendencias() {
    const conteudo = document.getElementById('pendencias-conteudo');
    const jaTemDados = conteudo && conteudo.querySelector('.bloco-pendencia');
    if (conteudo && !jaTemDados) {
        conteudo.innerHTML = '<div class="card"><p class="texto-vazio">Carregando situação do time...</p></div>';
    }

    let dados;
    try {
        dados = await api.pendencias();
    } catch (erro) {
        const msg = erro.message === 'cancelado'
            ? 'Acesso cancelado.'
            : `Não foi possível carregar os dados (${escapeHtml(erro.message)}).`;
        if (conteudo) conteudo.innerHTML = `<div class="card"><p style="color:var(--vermelho)">${msg}</p></div>`;
        ['lista-presentes-agora', 'lista-nao-chegaram'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `<p style="color:var(--vermelho); font-size:13px;">${msg}</p>`;
        });
        return;
    }

    if (conteudo) renderizar(dados);
    renderizarResumoDashboard(dados);
}
