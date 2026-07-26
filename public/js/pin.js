import { api } from './api.js';

/**
 * Pede o PIN pessoal do funcionário no totem. Usado antes de mostrar dados que são
 * só dele (histórico e espelho de ponto) — o totem é um tablet compartilhado, então
 * a identificação por seleção de nome não basta para liberar informação individual.
 *
 * Devolve true se o PIN conferir, false se a pessoa cancelar.
 */
let overlay = null;

function garantirModal() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modalPin';
    overlay.innerHTML = `
        <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="pin-titulo">
            <h3 id="pin-titulo">Confirme que é você</h3>
            <p class="confirmar-texto" id="pin-info"></p>
            <input type="password" class="campo" id="pin-campo" inputmode="numeric"
                   maxlength="8" autocomplete="off" placeholder="• • • •">
            <p class="erro-msg" id="pin-erro" role="alert"></p>
            <div class="modal-botoes">
                <button type="button" class="btn btn-secundario" id="pin-cancelar">Cancelar</button>
                <button type="button" class="btn btn-principal" id="pin-confirmar">Entrar</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    return overlay;
}

export function pedirPin(funcionarioId, nomeFuncionario) {
    const modal = garantirModal();
    const campo = modal.querySelector('#pin-campo');
    const erro = modal.querySelector('#pin-erro');
    const btnOk = modal.querySelector('#pin-confirmar');
    const btnCancelar = modal.querySelector('#pin-cancelar');

    modal.querySelector('#pin-info').textContent = `Digite o PIN pessoal de ${nomeFuncionario} para ver estes dados.`;
    campo.value = '';
    erro.textContent = '';
    modal.style.display = 'flex';
    setTimeout(() => campo.focus(), 50);

    return new Promise((resolve) => {
        function fechar(resultado) {
            modal.style.display = 'none';
            btnOk.removeEventListener('click', aoConfirmar);
            btnCancelar.removeEventListener('click', aoCancelar);
            campo.removeEventListener('keydown', aoTeclar);
            document.removeEventListener('keydown', aoEscape);
            resolve(resultado);
        }

        async function aoConfirmar() {
            const pin = campo.value.trim();
            if (!/^\d{4,8}$/.test(pin)) {
                erro.textContent = 'O PIN tem de 4 a 8 dígitos.';
                return;
            }
            btnOk.disabled = true;
            erro.textContent = '';
            try {
                await api.verificarPin(funcionarioId, pin);
                fechar(true);
            } catch (e) {
                erro.textContent = e.message || 'PIN incorreto.';
                campo.value = '';
                campo.focus();
            } finally {
                btnOk.disabled = false;
            }
        }
        function aoCancelar() { fechar(false); }
        function aoTeclar(ev) { if (ev.key === 'Enter') { ev.preventDefault(); aoConfirmar(); } }
        function aoEscape(ev) { if (ev.key === 'Escape') fechar(false); }

        btnOk.addEventListener('click', aoConfirmar);
        btnCancelar.addEventListener('click', aoCancelar);
        campo.addEventListener('keydown', aoTeclar);
        document.addEventListener('keydown', aoEscape);
    });
}
