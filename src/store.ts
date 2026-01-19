export interface ArticleListItem {
  sn: number;
  push: string;
  date: string;
  fixed: boolean;
  author: string;
  status: string;
  title: string;
}

class ArticleStore {
  private articleStore : { [boardname: string]: { [sn: number]: ArticleListItem } } = {};
  private articleIds : { [boardname: string]: Array<number> } = {};
  private currentPage : { [boardname: string]: number } = {};

  asList (boardname: string) {
    return (this.articleIds[boardname] || []).map(id => this.articleStore[boardname][id])
      .sort((a, b) => {
        if (a.fixed && b.fixed) {
          return 0;
        } else if (a.fixed) {
          return -1;
        } else {
          return 1;
        }
      });
  }

  add (boardname: string, articles: Array<ArticleListItem>) {
    articles.forEach(article => {
      this.articleStore[boardname] = this.articleStore[boardname] || {};
      this.articleStore[boardname][article.sn] = article;
    });
    const ids = this.articleIds[boardname] || [];
    this.articleIds[boardname] = [...new Set(ids.concat(articles.map(art => art.sn)))];
  }
  
  release (boardname: string) {
    this.articleStore[boardname] = [];
    this.articleIds[boardname] = [];
    this.currentPage[boardname] = 0;
  }

  clearArticles (boardname: string) {
    this.articleStore[boardname] = [];
    this.articleIds[boardname] = [];
  }

  lastSn (boardname: string) {
    return this.asList(boardname).slice(-1)[0].sn;
  }

  firstSn (boardname: string) {
    return this.asList(boardname)[0]?.sn;
  }

  isEmpty (boardname: string)
  {
    return this.asList(boardname).length === 0;
  }

  getBoardNames () {
    return Object.keys(this.articleStore);
  }

  getCurrentPage (boardname: string): number {
    return this.currentPage[boardname] || 0;
  }

  setCurrentPage (boardname: string, page: number) {
    this.currentPage[boardname] = page;
  }

  incrementPage (boardname: string) {
    this.currentPage[boardname] = (this.currentPage[boardname] || 0) + 1;
  }

  decrementPage (boardname: string) {
    this.currentPage[boardname] = Math.max(0, (this.currentPage[boardname] || 0) - 1);
  }
}

export default new ArticleStore();
