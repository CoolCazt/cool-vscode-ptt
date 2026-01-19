import * as vscode from 'vscode';
import PTT from 'ptt-client';
import key from 'ptt-client/dist/utils/keymap';

(global as any).WebSocket = require('ws');

import { PttTreeDataProvider, Board } from './pttDataProvider';
import ContentProvider from './provider';
import store, { ArticleListItem } from './store';

let ptt;
let ctx: vscode.ExtensionContext;
let pttProvider: PttTreeDataProvider;

export interface FavoriteBoardItem{
  bn: string;
  read: string;
  boardname: string;
  category: string;
  title: string;
  users: string;
  admin: string;
  folder: boolean;
  divider: boolean;
}

function intializePttClient () {
  return new Promise(resolve => {
    const ptt = new PTT({ origin: 'app://vscode-ptt' });
    ptt.once('connect', () => resolve(ptt));
  });
}

function checkLogin () {
  const { login } = ptt.state;
  return login;
}

async function getLoginCredential (silent = false) {
  let username = ctx.globalState.get('username');
  let password = ctx.globalState.get('password');

  if ((username && password) || silent) {
    return { username, password };
  }

  username = await vscode.window.showInputBox({
    placeHolder: '帳號',
    prompt: '請輸入 PTT 登入帳號'
  });

  if (!username) {
    return {};
  }

  password = await vscode.window.showInputBox({
    placeHolder: '密碼',
    prompt: '請輸入 PTT 登入密碼',
    password: true
  });

  return { username, password };
}

async function login (silent = false) {
  if (checkLogin()) {
    return;
  }

  const { username, password } = await getLoginCredential(silent);

  if (!username || !password) {
    if (!silent) {
      vscode.window.showWarningMessage('需要帳密才能使用 VSCode PTT 噢！');
    }
    return;
  }

  await ptt.login(username, password, vscode.workspace.getConfiguration().get('kickLogin'));
  var { login } = ptt.state;
  if (login) {
    ctx.globalState.update('username', username);
    ctx.globalState.update('password', password);
    pttProvider.refresh();
    if (!silent) {
      vscode.window.showInformationMessage(`以 ${username} 登入成功！`);
    }
  } else {
    if (!silent) {
      vscode.window.showWarningMessage('登入失敗 QQ');
    }
  }
}

async function pickFavorite (): Promise<string> {
  await login();

  const favorites:FavoriteBoardItem[] = await ptt.getFavorite();
  // TODO: exclude subscribed boards
  const favoriteItems: vscode.QuickPickItem[] = favorites.filter(f => !f.divider).map(fav => {
    return {
      label: fav.boardname,
      description: fav.title
    };
  });

  const board = await vscode.window.showQuickPick(favoriteItems);
  if (board){
    return board.label;
  }
  else{
    return null;
  }
}

function setSearchCondition(type: string, criteria: string): void
{
  ptt.setSearchCondition(type, criteria);
}

export async function activate(context: vscode.ExtensionContext) {
  ctx = context;

  if (!ptt) {
    ptt = await intializePttClient();
  }

  pttProvider = new PttTreeDataProvider(ptt, ctx);
  vscode.window.registerTreeDataProvider('pttTree', pttProvider);

  const provider = new ContentProvider(ptt);
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(ContentProvider.scheme, provider));

  context.subscriptions.push(vscode.commands.registerCommand('ptt.login', login));
  context.subscriptions.push(vscode.commands.registerCommand('ptt.logout', async () => {
    if (!checkLogin()) {
      return;
    }

    const res = await vscode.window.showInformationMessage('你確定要登出嗎？登出會一併清除您的訂閱看板', '好', '算了');
    if (res === '好') {
      ctx.globalState.update('username', null);
      ctx.globalState.update('password', null);
      ctx.globalState.update('boardlist', []);
      pttProvider.refresh();

      // logout
      await ptt.send(`${key.ArrowLeft.repeat(10)}${key.ArrowRight}y${key.Enter}`);
      // !FIXME: should be fixed in upstream  ptt-client library
      ptt._state.login = false;

      vscode.window.showInformationMessage('已登出 PTT');
    }
  }));
	context.subscriptions.push(vscode.commands.registerCommand('ptt.add-board', async function () {
    await login();

    if (!checkLogin()) {
      return;
    }

    const boardName = await vscode.window.showInputBox({
      prompt: '輸入看板名稱',
      placeHolder: 'C_Chat'
    });

    if (boardName){
      const checkBoard = await ptt.enterBoard(boardName);
      if (!checkBoard) {
        vscode.window.showInformationMessage("此看板不存在");
        return;
      }
    }
    else{
      return;
    }

    const boardlist: string[] = ctx.globalState.get('boardlist') || [];
    const boards = [...new Set(boardlist.concat(boardName))];
    ctx.globalState.update('boardlist', boards.filter(Boolean));
    pttProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ptt.show-article', async (sn, boardname) => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`${ContentProvider.scheme}:${boardname}/${sn}`));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ptt.remove-board', (board: Board) => {
    const boardlist: string[] = ctx.globalState.get('boardlist') || [];
    const boards = boardlist.filter(b => b !== board.boardname);
    ctx.globalState.update('boardlist', boards.filter(Boolean));
    pttProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ptt.refresh-article', () => {
    ptt.resetSearchCondition();
    // pttProvider.refresh();
    const boards = store.getBoardNames();
    boards.forEach(async (boardname: string) => {
      store.release(boardname);
      const articles = await ptt.getArticles(boardname);
      store.add(boardname, articles);
      pttProvider.refresh();
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ptt.jump-to-page', async (boardname: string) => {
    const currentPage = store.getCurrentPage(boardname);
    const pageInput = await vscode.window.showInputBox({
      prompt: '輸入要跳轉的頁碼',
      placeHolder: `目前在第 ${currentPage + 1} 頁`,
      validateInput: (value) => {
        const num = parseInt(value);
        if (isNaN(num) || num < 1) {
          return '請輸入有效的頁碼（大於 0 的整數）';
        }
        return null;
      }
    });

    if (!pageInput) {
      return;
    }

    const targetPage = parseInt(pageInput) - 1; // 轉換為 0-based index
    if (targetPage === currentPage) {
      vscode.window.showInformationMessage('已在該頁面');
      return;
    }

    vscode.window.showInformationMessage(`跳轉至第 ${targetPage + 1} 頁...`);
    
    try {
      const firstSn = store.firstSn(boardname);
      // 計算目標頁面的文章序號（假設每頁 20 篇）
      const pageDiff = targetPage - currentPage;
      const targetSn = firstSn - (pageDiff * 20);
      
      const articles = await ptt.getArticles(boardname, targetSn);
      if (articles.length > 0) {
        store.clearArticles(boardname);
        store.add(boardname, articles);
        store.setCurrentPage(boardname, targetPage);
        pttProvider.refresh();
        vscode.window.showInformationMessage(`已切換至第 ${targetPage + 1} 頁`);
      } else {
        vscode.window.showInformationMessage('該頁面無文章或超出範圍');
      }
    } catch (err) {
      vscode.window.showErrorMessage('跳轉頁面時發生錯誤');
      console.error('[PTT] jump-to-page error', err);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ptt.next-page', async (boardname: string) => {
    if (store.isEmpty(boardname)) {
      return;
    }

    const currentPage = store.getCurrentPage(boardname);
    const lastSn = store.lastSn(boardname);
    vscode.window.showInformationMessage('載入下一頁...');
    
    try {
      const articles = await ptt.getArticles(boardname, lastSn - 1);
      if (articles.length > 0) {
        store.clearArticles(boardname);
        store.add(boardname, articles);
        store.setCurrentPage(boardname, currentPage + 1);
        pttProvider.refresh();
        vscode.window.showInformationMessage(`已切換至第 ${store.getCurrentPage(boardname) + 1} 頁`);
      } else {
        vscode.window.showInformationMessage('已到達最後一頁');
      }
    } catch (err) {
      vscode.window.showErrorMessage('載入下一頁時發生錯誤');
      console.error('[PTT] next-page error', err);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ptt.previous-page', async (boardname: string) => {
    if (store.isEmpty(boardname)) {
      return;
    }

    const currentPage = store.getCurrentPage(boardname);
    if (currentPage === 0) {
      vscode.window.showInformationMessage('已在第一頁');
      return;
    }

    const firstSn = store.firstSn(boardname);
    vscode.window.showInformationMessage('載入上一頁...');
    
    try {
      // 從第一篇文章的序號往後載入
      const articles = await ptt.getArticles(boardname, firstSn + 19); // PTT 通常一頁顯示20篇
      if (articles.length > 0) {
        store.clearArticles(boardname);
        store.add(boardname, articles);
        store.setCurrentPage(boardname, currentPage - 1);
        pttProvider.refresh();
        vscode.window.showInformationMessage(`已切換至第 ${store.getCurrentPage(boardname) + 1} 頁`);
      } else {
        vscode.window.showInformationMessage('載入失敗');
      }
    } catch (err) {
      vscode.window.showErrorMessage('載入上一頁時發生錯誤');
      console.error('[PTT] previous-page error', err);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ptt.release-board', async (board: Board) => {
    store.release(board.boardname);
    pttProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ptt.search-board-by-push', async (board: Board) => {
    let push = await vscode.window.showInputBox({
      prompt: '輸入推文數',
      placeHolder: '0 ~ 100'
    });

    if (Number(push) > 100)
    {
      push = '100';
    }

    if (store.isEmpty(board.boardname) === false)
    {
      store.release(board.boardname);
    }

    vscode.window.showInformationMessage('開始搜尋');
    setSearchCondition("push", push);
    let pushArticles: ArticleListItem[] = await ptt.getArticles(board.boardname);
    vscode.window.showInformationMessage('完成搜尋');

    store.add(board.boardname, pushArticles);
    pttProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('ptt.search-board-by-title', async (board: Board) => {
    const title = await vscode.window.showInputBox({
      prompt: '輸入文章標題關鍵字',
      placeHolder: '例如：閒聊'
    });

    if (!title) {
      return;
    }

    if (store.isEmpty(board.boardname) === false)
    {
      store.release(board.boardname);
    }

    vscode.window.showInformationMessage('開始搜尋');
    setSearchCondition("title", title);
    let titleArticles: ArticleListItem[] = await ptt.getArticles(board.boardname);
    vscode.window.showInformationMessage('完成搜尋');

    store.add(board.boardname, titleArticles);
    pttProvider.refresh();
  }));

  context.subscriptions.push(
    vscode.commands.registerCommand('ptt.favorite-board', async () => {
      const boardlist: string[] = ctx.globalState.get('boardlist') || [];
      const boardName = await pickFavorite();
      const boards = [...new Set(boardlist.concat(boardName))];
      ctx.globalState.update('boardlist', boards.filter(Boolean)); //check if board exist?
      pttProvider.refresh();
    })
  );

  await login(true);
}

// this method is called when your extension is deactivated
export function deactivate() {}
