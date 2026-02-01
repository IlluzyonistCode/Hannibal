const { ipcRenderer } = require('electron');
const marked = require('marked');
const Chart = require('chart.js/auto');

let SERVER_URL = '';

try {
    SERVER_URL = ipcRenderer.sendSync('get-server-url');
} catch (e) {
    console.error('Failed to get server URL:', e);
}

let currentMode = 'paraphrase';
let debateContext = '';
const CHAT_MAP = {
    paraphrase: 'chat-history-paraphrase',
    debate: 'chat-history-debate'
};

function getChatHistoryElement(mode = currentMode) {
    const targetId = CHAT_MAP[mode] || CHAT_MAP.paraphrase;

    return document.getElementById(targetId);
}

window.showView = function(viewName) {
    document.querySelectorAll('.view').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('active-view');
        el.style.pointerEvents = 'none';
    });

    const targetView = document.getElementById(`view-${viewName}`);

    if (targetView) {
        targetView.classList.remove('hidden');
        targetView.classList.add('active-view');
        targetView.style.pointerEvents = 'auto';
    }

    if (viewName === 'vocab') loadVocab();

    if (viewName === 'trainer') {
        const trainerInput = document.getElementById('trainer-input');

        if (trainerInput) {
            trainerInput.disabled = false;

            setTimeout(() => trainerInput.focus(), 50);
        }
    }
};

window.setTrainerMode = function(mode) {
    currentMode = mode;

    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    
    if (window.event && window.event.target) window.event.target.classList.add('active');

    const modeDesc = document.getElementById('mode-description');

    Object.keys(CHAT_MAP).forEach(key => {
        const el = getChatHistoryElement(key);

        if (!el) return;

        if (key === mode) {
            el.classList.remove('hidden');
            el.innerHTML = '';
        }

        else el.classList.add('hidden');
    });

    if (mode === 'paraphrase') {
        if (modeDesc) modeDesc.textContent = "Режим 'Лингвистический Скальпель'. Введите обычную фразу для обработки.";
        
        addMessage('AI', 'Я готов препарировать ваши мысли. Введите фразу.', false, 'paraphrase');
    } else if (mode === 'debate') {
        if (modeDesc) modeDesc.textContent = "Режим 'Риторический спарринг'. Ситуация -> Ответ -> Критика.";
        
        startDebateRound();
    }
};

window.deleteVocab = async function(id) {
    if (!confirm('Delete this entry from your memory?')) return;

    try {
        await fetch(`${SERVER_URL}/vocab?id=${id}`, { method: 'DELETE' });
        
        loadVocab();
    } catch (e) {
        console.error(e);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const trainerInput = document.getElementById('trainer-input');
    const sendBtn = document.getElementById('send-btn');

    if (sendBtn) sendBtn.addEventListener('click', handleTrainerSend);

    if (trainerInput) {
        trainerInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();

                handleTrainerSend();
            }
        });
    }

    if (uploadZone && fileInput) {
        uploadZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
        uploadZone.addEventListener('dragover', e => { e.preventDefault();
            uploadZone.classList.add('drag-over'); });

        uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));

        uploadZone.addEventListener('drop', e => {
            e.preventDefault();

            uploadZone.classList.remove('drag-over');

            if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
        });
    }
});

function addMessage(sender, content, isHtml=false, mode=currentMode) {
    const chatHistory = getChatHistoryElement(mode);

    if (!chatHistory) return;

    const div = document.createElement('div');
    div.className = sender === 'User' ? 'user-msg' : 'ai-msg';

    if (isHtml) div.innerHTML = content;
    
    else div.textContent = content;

    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function createSaveButton(data, type) {
    const btn = document.createElement('button');
    btn.className = 'save-vocab-btn';
    btn.innerHTML = '🔖 Save to Lexicon';
    btn.onclick = () => saveToVocab(data, type, btn);

    return btn;
}

async function saveToVocab(data, type, btnElement) {
    const entry = { type: type, ...data };

    try {
        const res = await fetch(`${SERVER_URL}/vocab`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry)
        });

        if (res.ok) {
            btnElement.innerHTML = '✅ Saved';
            btnElement.disabled = true;
            btnElement.classList.add('saved');
        }
    } catch (e) {
        console.error(e);

        btnElement.innerHTML = '❌ Error';
    }
}

async function startDebateRound() {
    addMessage('AI', '<i>Генерирую ситуацию...</i>', true, 'debate');

    try {
        const res = await fetch(`${SERVER_URL}/train`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'debate_start' })
        });
        const data = await res.json();

        let situation = 'Не удалось получить ситуацию.';

        let r = data.response;

        if (typeof r === 'string') {
            try {
                const parsed = JSON.parse(r.replace(/```json|```/g, '').trim());
                
                situation = parsed.situation || parsed.text || r;
            } catch (e) {
                situation = r;
            }
        }

        else if (r && r.situation) situation = r.situation;

        debateContext = situation;

        const chatHistory = getChatHistoryElement('debate');

        if (chatHistory && chatHistory.lastChild) chatHistory.lastChild.remove();

        addMessage('AI', `<b>Ситуация:</b> ${situation}`, true, 'debate');
    } catch (e) {
        addMessage('AI', 'Ошибка соединения с чертогами разума.', false, 'debate');
    }
}

async function handleTrainerSend() {
    const trainerInput = document.getElementById('trainer-input');
    const activeMode = currentMode;
    const chatHistory = getChatHistoryElement(activeMode);

    const text = trainerInput.value.trim();
    
    if (!text) return;

    addMessage('User', text, false, activeMode);

    trainerInput.value = '';

    const payload = {
        text: text,
        mode: activeMode === 'debate' ? 'debate_eval' : 'paraphrase',
        context: activeMode === 'debate' ? debateContext : ''
    };

    const loadingId = 'loading-' + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'ai-msg';
    loadingDiv.id = loadingId;
    loadingDiv.innerHTML = '<span class="pulse">...</span>';
    chatHistory.appendChild(loadingDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    try {
        const res = await fetch(`${SERVER_URL}/train`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        const loader = document.getElementById(loadingId);

        if (loader) loader.remove();

        let r = data.response;

        if (data.error) {
            addMessage('AI', `Error: ${data.error}`, false, activeMode);

            return;
        }

        if (typeof r === 'string') {
            const cleanStr = r.replace(/```json\s?|```/g, '').trim();

            try {
                r = JSON.parse(cleanStr);
            } catch (e) {
                console.warn('Manual JSON parse failed, using raw text fallback');

                if (activeMode === 'paraphrase')
                    r = { ideal_version: cleanStr, analysis: 'Анализ (raw text output)' };
                
                else
                    r = { critique: cleanStr, score: '?', ideal_version: 'See critique' };
            }
        }

        if (r) {
            r.ideal_version = r.ideal_version || r.rewritten || r.text || r.response || r.paraphrase;
            r.analysis = r.analysis || r.comment || r.critique || r.explanation;
            r.word_of_day = r.word_of_day || r.word || r.term;
            r.word_def = r.word_def || r.definition || r.meaning;
        }

        if (r && r.error) {
            addMessage('AI', `<b>Ошибка генерации:</b> ${r.error}. <br>Модель вернула некорректные данные.`, true, activeMode);
            
            return;
        }

        if (activeMode === 'paraphrase') {
            const val = r.ideal_version || 'Error processing';

            const container = document.createElement('div');

            container.innerHTML = `
                <div class="result-block">
                    <strong>Ideal Version:</strong><br>
                    <span class="highlight-text">${val}</span>
                </div>
                <div class="analysis-block"><em>${r.analysis || ''}</em></div>
            `;

            if (r.ideal_version) {
                const saveBtn = createSaveButton({
                    phrase: r.ideal_version,
                    definition: r.analysis,
                    original: text
                }, 'phrase');

                container.appendChild(saveBtn);
            }

            const wrapper = document.createElement('div');

            wrapper.className = 'ai-msg';
            wrapper.appendChild(container);
            chatHistory.appendChild(wrapper);
        } else if (activeMode === 'debate') {
            const container = document.createElement('div');

            container.innerHTML = `
                <div class="metric-row"><strong>Score:</strong> ${r.score || '?'}/10</div>
                <p>${r.critique || r.analysis || 'No critique available.'}</p>
                <hr style="border-color:#333; margin:10px 0;">
                
                <div class="result-block">
                    <strong>Dr. Lecter's Version:</strong><br>
                    <span class="highlight-text">${r.ideal_version || '...'}</span>
                </div>
                
                <div class="vocab-block">
                    <strong>Word of the Day:</strong> <span style="color:#e0e0e0">${r.word_of_day || 'N/A'}</span><br>
                    <small>${r.word_def || ''}</small>
                </div>
            `;

            if (r.ideal_version)
                container.appendChild(createSaveButton({
                    phrase: r.ideal_version,
                    definition: "Context: " + debateContext,
                    original: text
                }, 'phrase'));

            if (r.word_of_day)
                container.appendChild(createSaveButton({
                    word: r.word_of_day,
                    definition: r.word_def
                }, 'word'));

            const wrapper = document.createElement('div');
            wrapper.className = 'ai-msg';
            wrapper.appendChild(container);
            chatHistory.appendChild(wrapper);

            setTimeout(() => {
                const debateChat = getChatHistoryElement('debate');

                if (!debateChat) return;

                const nextBtn = document.createElement('button');
                nextBtn.className = 'next-round-btn';
                nextBtn.innerText = 'Следующая ситуация >>';
                nextBtn.onclick = () => {
                    nextBtn.remove();

                    startDebateRound();
                };
                debateChat.appendChild(nextBtn);
                debateChat.scrollTop = debateChat.scrollHeight;
            }, 1000);
        }

    } catch (e) {
        const loader = document.getElementById(loadingId);

        if (loader) loader.remove();

        addMessage('AI', 'System Failure: ' + e.toString(), false, activeMode);

        console.error(e);
    }

    if (chatHistory) chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function loadVocab() {
    const vocabGrid = document.getElementById('vocab-grid');

    if (!vocabGrid) return;

    vocabGrid.innerHTML = '<div class="loading-pulse">Loading Mind Palace...</div>';
    
    try {
        const res = await fetch(`${SERVER_URL}/vocab`);
        const data = await res.json();

        renderVocab(data);
    } catch (e) {
        vocabGrid.innerHTML = 'Error loading archive.';

        console.error(e);
    }
}

function renderVocab(list) {
    const vocabGrid = document.getElementById('vocab-grid');

    if (!vocabGrid) return;

    vocabGrid.innerHTML = '';

    if (!list || list.length === 0) {
        vocabGrid.innerHTML = '<p class="empty-vocab">Archive is empty.</p>';

        return;
    }

    list.forEach(item => {
        const card = document.createElement('div');

        card.className = 'vocab-card';

        if (item.type === 'phrase')
            card.innerHTML = `
                <div class="vocab-type">PHRASE</div>
                <div class="vocab-main">"${item.phrase}"</div>
                <div class="vocab-sub">${item.definition || ''}</div>
                <button class="delete-btn" onclick="deleteVocab(${item.id})">×</button>
            `;
        
        else
            card.innerHTML = `
                <div class="vocab-type">WORD</div>
                <div class="vocab-main">${item.word}</div>
                <div class="vocab-sub">${item.definition}</div>
                <button class="delete-btn" onclick="deleteVocab(${item.id})">×</button>
            `;

        vocabGrid.appendChild(card);
    });
}

function updateStatus(message, isError = false) {
    const statusMessage = document.getElementById('status-message');

    if (statusMessage) {
        statusMessage.textContent = message;
        statusMessage.style.color = isError ? '#d32f2f' : '#8a0303';
    }
}

function renderMetrics(metricsDict) {
    const metricsContainer = document.getElementById('metrics-container');

    if (!metricsContainer) return;

    metricsContainer.innerHTML = '';
    metricsContainer.classList.remove('hidden');

    Object.keys(metricsDict).forEach(name => {
        const data = metricsDict[name];

        const card = document.createElement('div');
        card.className = 'metric-card';
        card.innerHTML = `
            <h4 class="participant-name">${name}</h4>
            <div class="metric-row"><span>Msgs:</span><span class="val">${data.total_messages}</span></div>
            <div class="metric-row"><span>Dom:</span><span class="val">${data.dominance_ratio}%</span></div>
        `;

        metricsContainer.appendChild(card);
    });
}

function renderAIProfile(markdownText) {
    const reportTabs = document.getElementById('report-tabs');
    const reportContent = document.getElementById('report-content');

    if (!reportTabs || !reportContent) return;

    reportTabs.innerHTML = '';
    reportTabs.classList.remove('hidden');
    reportContent.innerHTML = '';

    const pattern = /===\s*PROFILE:\s*(.+?)\s*===/g;
    let matches = [];
    let match;

    while ((match = pattern.exec(markdownText)) !== null)
        matches.push({ name: match[1].trim(), index: match.index, endIndex: match.index + match[0].length });

    if (matches.length === 0) {
        const contentDiv = document.createElement('div');
        contentDiv.className = 'tab-content';
        contentDiv.innerHTML = marked.parse(markdownText);

        reportContent.appendChild(contentDiv);

        return;
    }

    matches.forEach((current, i) => {
        const next = matches[i + 1];
        const text = markdownText.substring(current.endIndex, next ? next.index : markdownText.length).trim();

        const tabBtn = document.createElement('button');

        tabBtn.className = 'tab-btn';

        if (i === 0) tabBtn.classList.add('active');

        tabBtn.textContent = current.name;

        tabBtn.onclick = () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            tabBtn.classList.add('active');
            reportContent.innerHTML = marked.parse(text);
        };

        reportTabs.appendChild(tabBtn);

        if (i === 0) reportContent.innerHTML = marked.parse(text);
    });
}

async function handleFile(file) {
    updateStatus('Reading Evidence...');

    try {
        const text = await file.text();

        const fileType = file.name.toLowerCase().endsWith('.json') ? 'json' : 'text';
        const reportContent = document.getElementById('report-content');

        updateStatus('Analyzing... Hannibal is thinking...');
        
        if (reportContent) reportContent.innerHTML = '<div class="loading-pulse">Constructing Profile...</div>';

        const response = await fetch(`${SERVER_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_type: fileType, content: text })
        });

        const result = await response.json();

        if (response.ok) {
            updateStatus('Analysis Complete.');
            renderMetrics(result.metrics);
            renderAIProfile(result.ai_profile);
        } else {
            updateStatus('Analysis Failed', true);
            
            if (reportContent) reportContent.innerHTML = `<p style="color:red">Error: ${result.error}</p>`;
        }
    } catch (e) {
        console.error(e)

        updateStatus('Fatal Error', true);

        const reportContent = document.getElementById('report-content');

        if (reportContent) reportContent.innerHTML = `<p style="color:red">Fatal Error: ${e.toString()}</p>`;
    }
}
