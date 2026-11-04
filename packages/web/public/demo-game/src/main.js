/**
 * Tic-Tac-Toe Core Game Engine & View Controller
 */

const WINNING_COMBOS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
  [0, 4, 8], [2, 4, 6]             // Diagonals
];

class TicTacToeGame {
  constructor() {
    this.board = Array(9).fill(null);
    this.currentPlayer = 'X';
    this.isGameOver = false;
    this.winningCombo = null;
    this.mode = 'pve'; // 'pve' = vs bot, 'pvp' = local 2-player
    this.scores = { X: 0, O: 0, ties: 0 };

    this.cacheDom();
    this.bindEvents();
    this.updateUI();
  }

  cacheDom() {
    this.cells = Array.from(document.querySelectorAll('.cell'));
    this.statusBanner = document.getElementById('status-banner');
    this.scoreX = document.getElementById('score-x');
    this.scoreO = document.getElementById('score-o');
    this.scoreTies = document.getElementById('score-ties');
    this.labelO = document.getElementById('label-o');
    this.modeSelect = document.getElementById('mode');
    this.resetBtn = document.getElementById('reset-btn');
    this.resetAllBtn = document.getElementById('reset-all-btn');
    this.cardX = document.querySelector('.score-card.player-x');
    this.cardO = document.querySelector('.score-card.player-o');
  }

  bindEvents() {
    this.cells.forEach(cell => {
      cell.addEventListener('click', (e) => this.handleCellClick(e));
    });

    this.modeSelect.addEventListener('change', (e) => {
      this.mode = e.target.value;
      this.labelO.textContent = this.mode === 'pve' ? 'AI Bot (O)' : 'Player (O)';
      this.resetRound();
    });

    this.resetBtn.addEventListener('click', () => this.resetRound());
    this.resetAllBtn.addEventListener('click', () => this.resetAll());
  }

  handleCellClick(event) {
    const index = parseInt(event.currentTarget.dataset.index, 10);
    if (this.board[index] !== null || this.isGameOver) return;

    this.makeMove(index, this.currentPlayer);

    if (!this.isGameOver && this.mode === 'pve' && this.currentPlayer === 'O') {
      this.disableBoard(true);
      setTimeout(() => {
        this.aiTurn();
        this.disableBoard(false);
      }, 350);
    }
  }

  makeMove(index, player) {
    this.board[index] = player;
    const result = this.checkWin(this.board, player);

    if (result) {
      this.isGameOver = true;
      this.winningCombo = result;
      this.scores[player] += 1;
      this.updateUI();
      return;
    }

    if (this.board.every(cell => cell !== null)) {
      this.isGameOver = true;
      this.scores.ties += 1;
      this.updateUI();
      return;
    }

    this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
    this.updateUI();
  }

  checkWin(board, player) {
    for (const combo of WINNING_COMBOS) {
      if (combo.every(idx => board[idx] === player)) {
        return combo;
      }
    }
    return null;
  }

  aiTurn() {
    if (this.isGameOver) return;
    const bestMove = this.findBestMove();
    if (bestMove !== -1) {
      this.makeMove(bestMove, 'O');
    }
  }

  findBestMove() {
    for (let i = 0; i < 9; i++) {
      if (this.board[i] === null) {
        this.board[i] = 'O';
        if (this.checkWin(this.board, 'O')) {
          this.board[i] = null;
          return i;
        }
        this.board[i] = null;
      }
    }

    for (let i = 0; i < 9; i++) {
      if (this.board[i] === null) {
        this.board[i] = 'X';
        if (this.checkWin(this.board, 'X')) {
          this.board[i] = null;
          return i;
        }
        this.board[i] = null;
      }
    }

    if (this.board[4] === null) return 4;

    const corners = [0, 2, 6, 8].filter(idx => this.board[idx] === null);
    if (corners.length > 0) {
      return corners[Math.floor(Math.random() * corners.length)];
    }

    const edges = [1, 3, 5, 7].filter(idx => this.board[idx] === null);
    if (edges.length > 0) {
      return edges[Math.floor(Math.random() * edges.length)];
    }

    return -1;
  }

  disableBoard(disabled) {
    this.cells.forEach(cell => {
      if (this.board[parseInt(cell.dataset.index, 10)] === null) {
        cell.disabled = disabled;
      }
    });
  }

  resetRound() {
    this.board = Array(9).fill(null);
    this.currentPlayer = 'X';
    this.isGameOver = false;
    this.winningCombo = null;
    this.updateUI();
  }

  resetAll() {
    this.scores = { X: 0, O: 0, ties: 0 };
    this.resetRound();
  }

  updateUI() {
    this.cells.forEach((cell, idx) => {
      const val = this.board[idx];
      cell.textContent = val || '';
      cell.classList.remove('x', 'o', 'winning');
      if (val) cell.classList.add(val.toLowerCase());
      cell.disabled = val !== null || this.isGameOver;
    });

    if (this.winningCombo) {
      this.winningCombo.forEach(idx => {
        this.cells[idx].classList.add('winning');
      });
      const winnerName = this.currentPlayer === 'X' 
        ? 'Player X' 
        : (this.mode === 'pve' ? 'AI Bot (O)' : 'Player O');
      this.statusBanner.textContent = `🎉 ${winnerName} Wins!`;
    } else if (this.isGameOver) {
      this.statusBanner.textContent = "🤝 Game Drawn (Tie)!";
    } else {
      const turnName = this.currentPlayer === 'X' 
        ? 'Player X' 
        : (this.mode === 'pve' ? 'AI Bot (O)' : 'Player O');
      this.statusBanner.textContent = `Turn: ${turnName}`;
    }

    this.scoreX.textContent = this.scores.X;
    this.scoreO.textContent = this.scores.O;
    this.scoreTies.textContent = this.scores.ties;

    this.cardX.classList.toggle('active', !this.isGameOver && this.currentPlayer === 'X');
    this.cardO.classList.toggle('active', !this.isGameOver && this.currentPlayer === 'O');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new TicTacToeGame();
});
