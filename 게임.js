// ─────────────────────────────────────────────
//  운석 피하기 — 게임 본체
//  ⚠️ 이 파일은 고치지 않습니다.
//     난이도는 설정.js 에서만 바꿉니다.
// ─────────────────────────────────────────────

const 캔버스 = document.getElementById('무대');
const ctx = 캔버스.getContext('2d');
const 점수표시 = document.getElementById('점수');
const 최고표시 = document.getElementById('최고');
const 안내표시 = document.getElementById('안내');
const 시작버튼 = document.getElementById('시작');

const 폭 = 캔버스.width;
const 높이 = 캔버스.height;

let 우주선x, 운석들, 점수, 최고점수 = 0;
let 진행중 = false;
let 생성누적 = 0;
let 이전시각 = 0;
const 눌린키 = { 왼쪽: false, 오른쪽: false };

// ── 난이도 표시 ────────────────────────────────
function 난이도표시하기() {
  document.getElementById('난이도이름').textContent = 설정.이름;
  const 표 = document.getElementById('난이도표');
  표.innerHTML = '';
  const 항목 = [
    ['운석 최대 개수', 설정.운석_최대개수 + '개'],
    ['운석 생성 간격', 설정.운석_생성간격 + 'ms'],
    ['운석 낙하 속도', 설정.운석_낙하속도],
    ['운석 크기', 설정.운석_크기],
    ['우주선 이동 속도', 설정.우주선_이동속도],
  ];
  for (const [이름, 값] of 항목) {
    const 줄 = document.createElement('div');
    줄.className = '항목';
    줄.innerHTML = '<span>' + 이름 + '</span><b>' + 값 + '</b>';
    표.appendChild(줄);
  }
}

// ── 게임 시작 ──────────────────────────────────
function 시작하기() {
  우주선x = 폭 / 2;
  운석들 = [];
  점수 = 0;
  생성누적 = 0;
  이전시각 = performance.now();
  진행중 = true;
  안내표시.textContent = '← → 방향키로 피하세요';
  시작버튼.textContent = '다시 시작';
  requestAnimationFrame(한프레임);
}

// ── 운석 하나 만들기 ───────────────────────────
function 운석생성() {
  if (운석들.length >= 설정.운석_최대개수) return;
  운석들.push({
    x: 설정.운석_크기 + Math.random() * (폭 - 설정.운석_크기 * 2),
    y: -설정.운석_크기,
    속도: 설정.운석_낙하속도 * (0.8 + Math.random() * 0.5),
    회전: Math.random() * Math.PI,
  });
}

// ── 한 프레임 ──────────────────────────────────
function 한프레임(시각) {
  if (!진행중) return;

  let 간격 = 시각 - 이전시각;
  이전시각 = 시각;
  if (간격 > 100) 간격 = 100;          // 탭 전환 등으로 튀는 것 방지
  const 배속 = 간격 / 16.7;            // 60fps 기준

  // 우주선 이동
  if (눌린키.왼쪽) 우주선x -= 설정.우주선_이동속도 * 배속;
  if (눌린키.오른쪽) 우주선x += 설정.우주선_이동속도 * 배속;
  const 여백 = 설정.우주선_크기;
  if (우주선x < 여백) 우주선x = 여백;
  if (우주선x > 폭 - 여백) 우주선x = 폭 - 여백;

  // 운석 생성
  생성누적 += 간격;
  while (생성누적 >= 설정.운석_생성간격) {
    생성누적 -= 설정.운석_생성간격;
    운석생성();
  }

  // 운석 이동 · 충돌 검사
  const 우주선y = 높이 - 40;
  for (let i = 운석들.length - 1; i >= 0; i--) {
    const 운석 = 운석들[i];
    운석.y += 운석.속도 * 배속;

    const dx = 운석.x - 우주선x;
    const dy = 운석.y - 우주선y;
    const 거리 = Math.sqrt(dx * dx + dy * dy);
    if (거리 < 설정.운석_크기 + 설정.우주선_크기) {
      끝내기();
      return;
    }

    if (운석.y > 높이 + 설정.운석_크기) {
      운석들.splice(i, 1);
      점수 += 1;
    }
  }

  점수표시.textContent = 점수;
  그리기(우주선y);
  requestAnimationFrame(한프레임);
}

// ── 화면 그리기 ────────────────────────────────
function 그리기(우주선y) {
  ctx.fillStyle = '#070912';
  ctx.fillRect(0, 0, 폭, 높이);

  // 배경 별
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % 폭;
    const y = (i * 53) % 높이;
    ctx.fillRect(x, y, 2, 2);
  }

  // 운석
  for (const 운석 of 운석들) {
    ctx.save();
    ctx.translate(운석.x, 운석.y);
    ctx.rotate(운석.회전);
    ctx.fillStyle = '#ff6ec7';
    ctx.beginPath();
    const r = 설정.운석_크기;
    for (let k = 0; k < 7; k++) {
      const 각 = (Math.PI * 2 * k) / 7;
      const 길이 = r * (k % 2 === 0 ? 1 : 0.78);
      const px = Math.cos(각) * 길이;
      const py = Math.sin(각) * 길이;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 우주선
  const s = 설정.우주선_크기;
  ctx.fillStyle = '#45e0ff';
  ctx.beginPath();
  ctx.moveTo(우주선x, 우주선y - s);
  ctx.lineTo(우주선x - s, 우주선y + s);
  ctx.lineTo(우주선x, 우주선y + s * 0.4);
  ctx.lineTo(우주선x + s, 우주선y + s);
  ctx.closePath();
  ctx.fill();
}

// ── 게임 오버 ──────────────────────────────────
function 끝내기() {
  진행중 = false;
  if (점수 > 최고점수) 최고점수 = 점수;
  최고표시.textContent = 최고점수;

  ctx.fillStyle = 'rgba(7, 9, 18, 0.82)';
  ctx.fillRect(0, 높이 / 2 - 60, 폭, 120);
  ctx.fillStyle = '#ff6ec7';
  ctx.font = 'bold 30px "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('GAME OVER', 폭 / 2, 높이 / 2 - 8);
  ctx.fillStyle = '#e8ecf6';
  ctx.font = '16px "Malgun Gothic", sans-serif';
  ctx.fillText('피한 운석 ' + 점수 + '개', 폭 / 2, 높이 / 2 + 24);

  안내표시.textContent = '"다시 시작"을 누르세요';
}

// ── 입력 ───────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') 눌린키.왼쪽 = true;
  if (e.key === 'ArrowRight') 눌린키.오른쪽 = true;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ') e.preventDefault();
  if (e.key === ' ' && !진행중) 시작하기();
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft') 눌린키.왼쪽 = false;
  if (e.key === 'ArrowRight') 눌린키.오른쪽 = false;
});
캔버스.addEventListener('mousemove', (e) => {
  if (!진행중) return;
  const 사각 = 캔버스.getBoundingClientRect();
  우주선x = ((e.clientX - 사각.left) / 사각.width) * 폭;
});
시작버튼.addEventListener('click', 시작하기);

// ── 첫 화면 ────────────────────────────────────
난이도표시하기();
ctx.fillStyle = '#070912';
ctx.fillRect(0, 0, 폭, 높이);
ctx.fillStyle = '#9aa5c0';
ctx.font = '16px "Malgun Gothic", sans-serif';
ctx.textAlign = 'center';
ctx.fillText('"시작" 을 누르세요', 폭 / 2, 높이 / 2);
