import json
import os
import re
import time
from datetime import datetime
import pandas as pd
import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

OLLAMA_URL = 'http://192.168.1.38:11434/api/generate'
OLLAMA_MODEL = 'qwen3:8b'
FLASK_PORT = 5000
VOCAB_FILE = 'vocabulary.json'

app = Flask(__name__)
CORS(app)


def load_vocab():
    if not os.path.exists(VOCAB_FILE):
        return []

    try:
        with open(VOCAB_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []

def save_vocab_entry(entry):
    vocab = load_vocab()
    entry['id'] = int(time.time() * 1000)
    entry['date'] = datetime.now().isoformat()
    vocab.insert(0, entry)

    with open(VOCAB_FILE, 'w', encoding='utf-8') as f:
        json.dump(vocab, f, ensure_ascii=False, indent=2)

    return entry

def delete_vocab_entry(entry_id):
    vocab = load_vocab()
    vocab = [v for v in vocab if v.get('id') != entry_id]

    with open(VOCAB_FILE, 'w', encoding='utf-8') as f:
        json.dump(vocab, f, ensure_ascii=False, indent=2)

        return True

def normalize_label(label):
    return label.strip().lower().replace('ё', 'е')


PARAPHRASE_ALIASES = {
    'original': ['original', 'оригинал', 'исходник', 'фраза', 'текст', 'исходный текст'],
    'ideal_version': ['идеал', 'идеальная версия', 'идеальный вариант', 'версия', 'перепись', 'идеалка', 'ideal version', 'refined', 'улучшенная'],
    'analysis': ['анализ', 'комментарий', 'разбор', 'оценка', 'analysis', 'explanation', 'объяснение', 'пояснение', 'примечание']
}

DEBATE_ALIASES = {
    'score': ['оценка', 'score', 'балл', 'рейтинг'],
    'critique': ['критика', 'critique', 'разбор', 'комментарий'],
    'ideal_version': ['идеал', 'идеальная версия', 'идеальный вариант', 'версия', 'ответ лектора'],
    'word_of_day': ['слово дня', 'word of the day', 'термин'],
    'word_def': ['определение', 'definition', 'расшифровка']
}

SECTION_REGEX = re.compile(
    r'^\s*([A-Za-zА-Яа-яЁё\s]+):\s*(.+?)(?=\n\s*[A-Za-zА-Яа-яЁё\s]+:\s|\n*$)',
    re.S | re.M
)


def parse_colon_sections(raw_text, alias_map):
    parsed = {}

    for label, value in SECTION_REGEX.findall(raw_text):
        norm_label = normalize_label(label)
        matched_key = None

        for key, aliases in alias_map.items():
            if norm_label in aliases:
                matched_key = key

                break

        if matched_key:
            parsed[matched_key] = value.strip()

    return parsed

def build_response_from_text(mode, raw_text):
    if mode == 'paraphrase':
        data = parse_colon_sections(raw_text, PARAPHRASE_ALIASES)
        
        if 'ideal_version' not in data:
            ideal_match = re.search(r'(?:Идеальная версия|Ideal Version|идеал|версия)[:\s]+(.+?)(?=\n\s*(?:Анализ|Analysis|Оригинал|Original):|\n*$)', raw_text, re.S | re.I)
            
            if ideal_match:
                data['ideal_version'] = ideal_match.group(1).strip()

            else:
                data['ideal_version'] = raw_text.strip()
        
        if 'analysis' not in data:
            analysis_match = re.search(r'(?:Анализ|Analysis|комментарий|разбор)[:\s]+(.+?)(?=\n\s*(?:Оригинал|Original|Идеальная версия|Ideal Version):|\n*$)', raw_text, re.S | re.I)
            
            if analysis_match:
                data['analysis'] = analysis_match.group(1).strip()

            else:
                data['analysis'] = '' if 'ideal_version' in data and data['ideal_version'] else 'Модель вернула свободный текст без разбора.'
        
        data.setdefault('original', '')

        return data

    if mode == 'debate_eval':
        data = parse_colon_sections(raw_text, DEBATE_ALIASES)

        if 'critique' not in data:
            data['critique'] = raw_text.strip()

        data.setdefault('score', '?')
        data.setdefault('ideal_version', '')
        data.setdefault('word_of_day', '')
        data.setdefault('word_def', '')

        return data

    if mode == 'debate_start':
        data = parse_colon_sections(raw_text, {'situation': ['ситуация', 'situation']})
        
        if 'situation' not in data:
            data['situation'] = raw_text.strip()

        return data

    return {'raw': raw_text.strip()}


def parse_unformatted_text(raw_text):
    messages = []
    cleaned_text = re.sub(r'<[^>]+>', '', raw_text)
    lines = cleaned_text.strip().split('\n')
    current_sender = None
    current_timestamp = None
    header_pattern = re.compile(r'^(?P<sender>[^,]+),\s*\[(?P<timestamp>\d{2}\.\d{2}\.\d{4}\s\d{2}:\d{2})\]')
    inline_patterns = [
        re.compile(r'^\[(?P<timestamp>.*?)\]\s*(?P<sender>[^:]+):\s*(?P<text>.*)$'),
        re.compile(r'^(?P<sender>[^:]+):\s*(?P<text>.*)$')
    ]

    for line in lines:
        line = line.strip()

        if not line:
            continue

        header_match = header_pattern.match(line)

        if header_match:
            data = header_match.groupdict()
            current_sender = data['sender'].strip()

            try:
                dt = datetime.strptime(data['timestamp'].strip(), '%d.%m.%Y %H:%M')
                current_timestamp = dt.isoformat()
            except ValueError:
                current_timestamp = datetime.now().isoformat()

            continue

        if current_sender:
            messages.append({
                'id': len(messages) + 1, 'type': 'message',
                'date': current_timestamp or datetime.now().isoformat(),
                'from': current_sender, 'text': line
            })

            current_sender = None
            current_timestamp = None

            continue

        for pattern in inline_patterns:
            match = pattern.match(line)

            if match:
                data = match.groupdict()
                sender = data['sender'].strip()

                if ':' in sender and len(sender.split()[-1]) == 2:
                    continue

                iso_date = datetime.now().isoformat()

                if 'timestamp' in data and data['timestamp']:
                    try:
                        dt = datetime.strptime(data['timestamp'].strip(), '%d.%m.%Y %H:%M')
                        iso_date = dt.isoformat()
                    except ValueError:
                        pass

                messages.append({
                    'id': len(messages) + 1, 'type': 'message',
                    'date': iso_date, 'from': sender, 'text': data['text'].strip()
                })

                break

    return {'messages': messages}

def calculate_hard_metrics(chat_data):
    messages = chat_data.get('messages', [])

    valid_messages = [m for m in messages if m.get('type') == 'message' and isinstance(m.get('text'), str) and m.get('text').strip()]
    
    if not valid_messages:
        return {}

    df = pd.DataFrame(valid_messages)

    if df.empty:
        return {}

    participants = df['from'].unique()
    stats = {}
    total_words_chat = sum(len(m['text'].split()) for m in valid_messages)

    for person in participants:
        person_msgs = df[df['from'] == person]
        word_count = sum(len(text.split()) for text in person_msgs['text'])
        dominance = word_count / total_words_chat if total_words_chat > 0 else 0
        stats[person] = {
            'total_messages': len(person_msgs),
            'dominance_ratio': round(dominance * 100, 2),
            'avg_latency_min': 0 
        }

    return stats

def ollama_generate(prompt, system_prompt=None, temperature=0.7, json_mode=False):
    payload = {
        'model': OLLAMA_MODEL,
        'prompt': prompt,
        'stream': False,
        'options': {
            'num_ctx': 8192,
            'temperature': temperature,
            'num_predict': 512
        }
    }

    if system_prompt:
        payload['system'] = system_prompt

    if json_mode:
        payload['format'] = 'json'

    try:
        response = requests.post(OLLAMA_URL, json=payload, timeout=60000)
        response.raise_for_status()

        return response.json().get('response', '')
    except Exception as e:
        return f'{{"error": "{str(e)}"}}'

def chunk_analyze_synthesize(chat_data):
    messages = chat_data.get('messages', [])
    participants = list(set(m.get('from') for m in messages if m.get('from')))
    participants_str = ', '.join(participants)
    full_text = '\n'.join([f"[{m.get('from')} ({m.get('date')})]: {m.get('text')}" for m in messages if m.get('text')])
    
    if not full_text:
        return '=== PROFILE: ERROR ===\nNo valid text content found.'

    CHUNK_SIZE = 6000
    OVERLAP = 500
    chunks = []
    start = 0

    while start < len(full_text):
        end = min(start + CHUNK_SIZE, len(full_text))
        chunks.append(full_text[start:end])

        if end == len(full_text):
            break

        start = end - OVERLAP
    
    chunk_summaries = []
    
    system_prompt_analyst = (
        'You are an expert forensic behavioral profiler. '
        'Extract facts, communication patterns, and manipulations. '
        'Ignore small talk. Look for power plays, delays, traps. '
        'Provide a dry factual summary in English.'
    )
    analysis_template = 'Analyze chat between {p}. Identify: Power Dynamics, Hidden Motives, Red Flags. Quote phrases.\n\n--- CHAT ---\n{c}'
    
    for i, chunk in enumerate(chunks):
        print(f'Analyzing chunk {i+1}/{len(chunks)}...')

        summary = ollama_generate(analysis_template.format(p=participants_str, c=chunk), system_prompt_analyst, 0.3)
        chunk_summaries.append(summary)
        
    aggregated = '\n'.join(chunk_summaries)

    print('Synthesizing final profile...')
    
    system_prompt_hannibal = (
        'You are Dr. Hannibal Lecter. Analyze behavioral reports to create profiles. '
        'Tone: Sophisticated, polite, ruthlessly critical. Use metaphors (cuisine, music, anatomy). '
        'Mock mediocrity. '
        'IMPORTANT: The user speaks Russian. You MUST output the final profile in RUSSIAN.'
    )

    final_prompt = (
        f'Observations of {participants_str}:\n{aggregated}\n\n'
        'INSTRUCTIONS:\n1. Synthesize into character studies.\n'
        '2. Use header "=== PROFILE: [Name] ===".\n'
        '3. Format: === PROFILE: [Name] ===\n[Analysis in Lecter style in Russian]'
    )

    return ollama_generate(final_prompt, system_prompt_hannibal, 0.7)

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok'}), 200

@app.route('/analyze', methods=['POST'])
def analyze_chat():
    try:
        payload = request.json
        content = payload.get('content', '')
        file_type = payload.get('file_type', 'text')
        chat_data = json.loads(content) if file_type == 'json' else parse_unformatted_text(content)
        
        if not chat_data or not chat_data['messages']:
            return jsonify({'error': 'No messages parsed.'}), 400

        metrics = calculate_hard_metrics(chat_data)
        ai_profile = chunk_analyze_synthesize(chat_data)

        return jsonify({'metrics': metrics, 'ai_profile': ai_profile}), 200
    except Exception as e:
        print(f'Error: {e}')
        return jsonify({'error': str(e)}), 500

@app.route('/vocab', methods=['GET', 'POST', 'DELETE'])
def vocab_manager():
    if request.method == 'GET':
        return jsonify(load_vocab())
    
    if request.method == 'POST':
        data = request.json
        saved = save_vocab_entry(data)

        return jsonify(saved)
    
    if request.method == 'DELETE':
        entry_id = request.args.get('id', type=int)
        delete_vocab_entry(entry_id)

        return jsonify({'status': 'deleted'})

@app.route('/train', methods=['POST'])
def train_rhetoric():
    try:
        data = request.json
        mode = data.get('mode', 'paraphrase')
        user_input = data.get('text', '')
        context = data.get('context', '')

        system_prompt = ''
        user_prompt = ''

        if mode == 'paraphrase':
            system_prompt = (
                'You are Dr. Hannibal Lecter. Rewrite the user\'s Russian text into your unique idiolect. '
                'You MUST respond in Russian using exactly this format with all three sections:\n'
                'Оригинал: [the original text]\n'
                'Идеальная версия: [your refined version - complete, polished sentences]\n'
                'Анализ: [brief explanation of what changed and why]\n'
                'IMPORTANT: \n'
                '- All phrases must be complete and finished. Never leave sentences unfinished or with ellipsis.\n'
                '- Every sentence in \'Идеальная версия\' must be a complete, polished thought.\n'
                '- Always include all three sections: Оригинал, Идеальная версия, and Анализ.\n'
                '- Keep it concise, but ensure every phrase is fully articulated.'
            )
            user_prompt = f'Text: {user_input}'

        elif mode == 'debate_start':
            system_prompt = (
                'You are Dr. Hannibal Lecter. Generate a social situation in Russian where someone is rude. '
                'Respond in the format:\n'
                'Ситуация: ...\n'
                'Only provide the situation, nothing else.'
            )
            user_prompt = 'Generate situation.'

        elif mode == 'debate_eval':
            system_prompt = (
                'You are Dr. Hannibal Lecter. Analyze the student\'s response. '
                'Respond in Russian using newline-separated sections with colons:\n'
                'Оценка: (число 1-10)\n'
                'Критика: ...\n'
                'Идеальная версия: ...\n'
                'Слово дня: ...\n'
                'Определение: ...\n'
                'Do not wrap the answer in JSON or code fences.'
            )
            user_prompt = f'Situation: {context}\nStudent Response: \'{user_input}\''

        response_text = ollama_generate(user_prompt, system_prompt, temperature=0.8, json_mode=False)

        response_json = build_response_from_text(mode, response_text)

        return jsonify({'response': response_json}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(port=FLASK_PORT, debug=False, use_reloader=False)
