import * as vscode from 'vscode';

import store from './store';

type Node = Board | Article | PageNumberItem | PreviousPageArticle | NextPageArticle;

export class PttTreeDataProvider implements vscode.TreeDataProvider<Node> {
  constructor (private ptt, private ctx: vscode.ExtensionContext) {}

	private _onDidChangeTreeData: vscode.EventEmitter<Board | undefined> = new vscode.EventEmitter<Board | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Board | undefined> = this._onDidChangeTreeData.event;

  refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem (element: Node): vscode.TreeItem {
		return element;
	}

  async getChildren (element?: Node): Promise<Node[]> {
    if (!this.ptt.state.login) {
      return [];
    }

    try {
      let childrenFactory = new ChildrenFactory(element, this.ptt, this.ctx);
      return await childrenFactory.getChidrenType().getNode();
    } catch (err) {
      vscode.window.showErrorMessage('載入資料時發生錯誤，可能是 PTT 格式變更或連線異常。請檢查 console log 或回報開發者。');
      console.error('[PTT] getChildren error', err);
      return [];
    }
  }
}

export interface IChildren{
  getNode(): Promise<Node[]>;
}

export class ArticleChildren implements IChildren
{
  element: Node;
  ptt: any;

  constructor(element: Node, ptt: any)
  {
    this.element = element;
    this.ptt = ptt;
  }
  
  async getNode(): Promise<Node[]>
  {
    const articleNodes = await this.createArticleList((this.element as Board).boardname);
    return articleNodes;
  }
  
  async createArticleList(boardname: string)
  {
    try {
      let articles = store.asList(boardname);
      if (articles.length === 0) {
        articles = await this.ptt.getArticles(boardname);
        store.add(boardname, articles);
        store.setCurrentPage(boardname, 0);
      }

      const currentPage = store.getCurrentPage(boardname);
      let articlesList: (Article | PageNumberItem | PreviousPageArticle | NextPageArticle)[] = [];

      // 顯示頁碼
      articlesList.push(new PageNumberItem(boardname, currentPage));

      // 如果不在第一頁，顯示上一頁按鈕
      if (currentPage > 0) {
        articlesList.push(new PreviousPageArticle(boardname));
      }

      // 下一頁按鈕
      articlesList.push(new NextPageArticle(boardname));

      articlesList.push(
        ...store.asList(boardname).map(article => new Article(
          Number(article.sn),
          `${article.push} ${article.status} ${article.title}`,
          vscode.TreeItemCollapsibleState.None,
          {
            command: 'ptt.show-article',
            title: '',
            arguments: [article.sn, boardname]
          }
        )).sort((article1, article2) => { // revert sorting order
          if (article1.sn > article2.sn) { return -1; }
          else if (article1.sn < article2.sn) { return 1; }
          return 0;
        })
      );

      return articlesList;
    } catch (err) {
      vscode.window.showErrorMessage('載入文章列表時發生錯誤，可能是 PTT 格式變更或連線異常。');
      console.error('[PTT] createArticleList error', err);
      return [];
    }
  }
}

export class StartupChildren implements IChildren
{
  ctx: vscode.ExtensionContext;
  
  constructor(ctx: vscode.ExtensionContext)
  {
    this.ctx = ctx;
  }

  async getNode(): Promise<Node[]>
  {
    const boardlist: string[] = this.ctx.globalState.get('boardlist') || [];
    if (boardlist.length > 0) {
      return boardlist.sort().map(board => new Board(board, vscode.TreeItemCollapsibleState.Collapsed));
    } else {
      return [];
    }
  }
}

export class ChildrenFactory
{
  element: Node;
  ptt: any;
  ctx: vscode.ExtensionContext;

  constructor(element: Node, ptt: any, ctx: vscode.ExtensionContext)
  {
    this.element = element;
    this.ptt = ptt;
    this.ctx = ctx;
  }

  getChidrenType(): IChildren
  {
    if (this.element === undefined)
    {
      return new StartupChildren(this.ctx);
    }
    else
    {
      return new ArticleChildren(this.element, this.ptt);
    }
  }
}

export class Board extends vscode.TreeItem {
  constructor (
    public readonly boardname: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command
  ) {
    super(boardname, collapsibleState);
  }

  contextValue = 'board';
}

export class Article extends vscode.TreeItem {
	constructor(
    public readonly sn: number,
		public readonly title: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(title, collapsibleState);
  }

  contextValue = 'article';
}

class PageNumberItem extends vscode.TreeItem {
  constructor (boardname: string, currentPage: number) {
    super(`📄 第 ${currentPage + 1} 頁`, vscode.TreeItemCollapsibleState.None);
    this.command = {
      command: 'ptt.jump-to-page',
      title: '',
      arguments: [boardname]
    };
    this.tooltip = '點擊跳轉到指定頁面';
  }
}

class PreviousPageArticle extends vscode.TreeItem {
  constructor (boardname: string) {
    super('← 上一頁', vscode.TreeItemCollapsibleState.None);

    this.command = {
      command: 'ptt.previous-page',
      title: '',
      arguments: [boardname]
    };
  }
}

class NextPageArticle extends vscode.TreeItem {
  constructor (boardname: string) {
    super('→ 下一頁', vscode.TreeItemCollapsibleState.None);

    this.command = {
      command: 'ptt.next-page',
      title: '',
      arguments: [boardname]
    };
  }
}
