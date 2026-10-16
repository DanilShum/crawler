// Запускает dev:server и dev:web параллельно: вывод с префиксами [server]/[web],
// падение одного процесса гасит второй, Ctrl+C останавливает оба.
import { spawn } from 'node:child_process';

const procs = new Map();

function killProc(child, signal = 'SIGTERM') {
	// npm порождает вложенные процессы (sh → tsx/vite): убиваем всю группу,
	// иначе внуки остаются жить после смерти launcher'а
	if (process.platform === 'win32' || typeof child.pid !== 'number') {
		child.kill(signal);
		return;
	}
	try {
		process.kill(-child.pid, signal);
	} catch {
		child.kill(signal);
	}
}

function run(name, args) {
	const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
	procs.set(name, child);
	const tag = `[${name}]`;
	const forward = (stream) => {
		let buf = '';
		stream.setEncoding('utf8');
		stream.on('data', (chunk) => {
			buf += chunk;
			let idx;
			while ((idx = buf.indexOf('\n')) >= 0) {
				console.log(`${tag} ${buf.slice(0, idx)}`);
				buf = buf.slice(idx + 1);
			}
		});
	};
	forward(child.stdout);
	forward(child.stderr);
	child.on('exit', (code) => {
		procs.delete(name);
		console.log(`${tag} завершён (code ${code ?? 'signal'})`);
		// один упал — гасим второй, чтобы стенд не оставался в полурабочем состоянии
		for (const other of procs.values()) killProc(other);
		process.exitCode = code ?? 1;
	});
}

run('server', ['run', 'dev:server']);
run('web', ['run', 'dev:web']);

process.on('SIGINT', () => {
	for (const child of procs.values()) killProc(child, 'SIGINT');
});
