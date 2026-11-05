import type { Locale } from './locale';

/* The copy of the home page, the Satyr page and the 404 page. English is the
   source; Japanese must fill the same shape, so a missing string fails the
   type check. Product names (Satyr, Satyr Kitchen, Seams Wallet, Slack) and
   Portal screenshots stay in English. A `rest` string follows a bold `lead`
   with no space added, so English starts it with a space and Japanese does not. */

/* A zero-width space: the only place where a Japanese headline may break.
   Headlines set `word-break: keep-all` in Japanese, so each phrase stays whole. */
const Z = '\u200b';

const en = {
  common: {
    talkToUs: 'Talk to us',
    exploreSatyr: 'Explore Satyr',
    exploreKitchen: 'Explore Satyr Kitchen',
    exploreWallet: 'Explore Seams Wallet',
    readDocs: 'Read the docs',
    products: 'Products',
    productViews: 'Product views',
  },
  homeHero: {
    title: 'Ecommerce on autopilot.',
    titleMuted: 'For cafés and pâtisseries.',
    sub: 'Satyr agents run your shop, inbox and bake plan. Changes that matter wait for your approval.',
  },
  tour: {
    label: 'Product tour',
    tabsLabel: 'Products',
    views: 'Product views',
    explore: 'Explore {name}',
    features: '{name} features',
    tabs: { satyr: 'Satyr Shop', kitchen: 'Satyr Kitchen' },
    items: {
      inbox: {
        title: 'Replies wait for you',
        body: 'An agent drafts each customer reply and shows its sources. Nothing is sent until you approve it.',
        alt: 'The Satyr Inbox with a reply that an agent drafted for a customer',
      },
      activity: {
        title: 'Every Case of the day',
        body: 'See what each agent works on, and which Cases wait for a person.',
        alt: 'The Activity timeline of the Satyr Portal with three Cases that wait for a person',
      },
      orders: {
        title: 'Orders that need you',
        body: 'Agents check each order against your rules. When one fails, you see why, with an email ready to approve.',
        alt: 'The Orders page of the Satyr Portal with two orders that need a person',
      },
      plan: {
        title: 'Orders become a bake plan',
        body: 'Satyr turns the day’s orders into batches, steps and times for the kitchen.',
        alt: 'Satyr Kitchen: the 3D bakery above the production timeline',
      },
      batch: {
        title: 'Each batch, step by step',
        body: 'Open a batch to see its current step, its baker and when it will finish.',
        alt: 'Satyr Kitchen: the details of one batch of 48 financiers',
      },
      floor: {
        title: 'Rehearse the shift',
        body: 'Play the morning in the floor plan and the 3D kitchen before the shift starts.',
        alt: 'Satyr Kitchen: the floor plan and the 3D view of the bakery',
      },
    },
  },
  duo: {
    title: 'From the shop to the oven',
    copy: 'Satyr runs the sales side of the business, and Satyr Kitchen plans what you bake. Both work from the same orders.',
    satyr:
      'Agents run the online shop, menus, orders, payments and the inbox. Changes wait for your approval in Slack or in the Portal.',
    kitchen:
      'Orders and preorders become production runs. See each run as a workflow, a timeline of ovens and staff, and a 3D view of the bakery.',
  },
  ecosystem: {
    title: 'Connects to the tools a café already uses',
    sub: 'Slack, Gmail, Shopify, Square, Stripe and your files. Each connection has its own access, and you can disconnect it at any time.',
    fieldLabel: 'A field of wheat with a connected tool over some of the stalks: {tools}',
  },
  pillars: {
    title: 'One suite for the whole business',
    sub: 'The online shop, the inbox and the kitchen work from the same orders.',
    tablist: 'Suite areas',
    items: {
      shop: {
        label: 'Shop and menus',
        lead: 'Menus, products and the storefront.',
        rest: ' Agents draft menus and product descriptions with you, and publish a menu when you approve it.',
        alt: 'The Checkout page of the Satyr Portal: how customers buy from the café’s storefront',
      },
      orders: {
        label: 'Orders and payments',
        lead: 'Orders, payments, refunds and gift cards.',
        rest: ' Card payments go to your own Stripe or Square account. Ask in Slack for a brief on failed payments and late orders.',
        alt: 'The Orders page of the Satyr Portal: two orders that a shop rule holds, each with one action, above the orders that are on track',
      },
      inbox: {
        label: 'Inbox',
        lead: 'Customer and supplier mail, answered.',
        rest: ' The inbox agent drafts each reply with the sources it used, and links each sender to the right customer or supplier.',
        alt: 'The Satyr Inbox: a reply that an agent drafted waits for approval',
      },
      production: {
        label: 'Production',
        lead: 'Satyr Kitchen turns orders into a bake plan.',
        rest: ' One production run shows as a workflow, a timeline of ovens and staff, and a 3D view of the bakery.',
        alt: 'Satyr Kitchen: a 3D view of the bakery above the timeline of three batches',
      },
      vault: {
        label: 'Vault',
        lead: 'Logins and keys that agents use but never see.',
        rest: ' Keep them in the Satyr Vault or in your own 1Password.',
        alt: 'The Vault page of the Satyr Portal: logins and API keys that agents use',
      },
    },
  },
  bento: {
    title: 'Agents act inside your rules',
    sub: 'Agents prepare the work. People approve the changes that matter, and every action leaves a receipt.',
    slack: {
      label: 'Approval card in a Slack thread',
      title: 'Approval card · #cafe-ops',
      change: 'Publish the autumn menu',
      changeNote: 'prepared by the shop agent · 14 items',
      needed: 'Approval needed',
      who: 'Who can approve',
      whoNote: 'an owner or an admin',
      people: '2 people',
      approve: 'Approve',
      decline: 'Decline',
    },
    money: {
      label: 'A refund held for approval in the Portal',
      title: 'Refund ¥4,200 · order #2377',
      moves: 'Moves money',
      movesNote: 'a chat card cannot approve it',
      held: 'Held',
      portal: 'Approve in the Portal',
      portalNote: 'owner',
      waiting: 'Waiting',
      receipt: 'Receipt',
      receiptNote: 'the provider’s confirmation is kept',
      auto: 'Auto',
    },
    cards: {
      thread: {
        title: 'Approve in the thread',
        copy: 'An agent posts each change to the shop as a card in Slack. An owner or admin approves it there, and the agent goes on.',
      },
      money: {
        title: 'Money moves only from the Portal',
        copy: 'A chat card cannot approve a refund or a payment. The approval happens in the Portal, and Satyr keeps the provider’s confirmation.',
      },
      roles: {
        title: 'Roles',
        copy: 'Owners, admins and members each get their own access to each connected tool.',
      },
      receipts: {
        title: 'Receipts',
        copy: 'Each action records who asked for it, what changed and what the provider confirmed.',
      },
      secrets: {
        title: 'Secrets stay out',
        copy: 'Agents use logins and API keys from the Vault, but no key enters a prompt or a transcript.',
      },
    },
  },
  cases: {
    title: 'Turn café work into agent workflows',
    sub: 'Agents watch the shop and the inbox, prepare the work, and act inside the limits that you set.',
    items: {
      shop: {
        title: 'Run the online shop',
        coverLabel: 'Shop',
        copy: 'Agents draft menus and product descriptions with you, and publish each menu to the storefront when you approve it.',
      },
      inbox: {
        title: 'Answer the inbox',
        coverLabel: 'Inbox',
        copy: 'The inbox agent reads customer and supplier mail, drafts each reply with its sources, and moves spam out of the way.',
      },
      orders: {
        title: 'Watch payments and orders',
        coverLabel: 'Orders',
        copy: 'Ask in Slack for a brief on failed payments and late orders. Each item links to its order, and an agent can look into it for you.',
      },
    },
    flow: {
      label: 'A gift box order flowing through checks into the bake plan and a confirmation email',
      tag: 'Satyr · gift box order',
      newOrder: 'New order',
      giftBoxes: 'Gift boxes ×12',
      giftNote: '¥64,800 · pickup Sat 10:30',
      new: 'New',
      checks: 'Checks',
      stock: 'Stock for Saturday',
      pickup: 'Pickup slot',
      discount: 'Company discount 10%',
      pass: 'Pass',
      ownerApproval: 'Owner approval',
      actions: 'Actions',
      planned: 'Added to the bake plan',
      plannedNote: 'Satyr Kitchen · 2 trays',
      plannedChip: 'Planned',
      email: 'Confirmation email',
      sent: 'Sent',
      receipt: 'Receipt recorded',
      auto: 'Auto',
    },
  },
  production: {
    title: 'Satyr Kitchen: from orders to the oven',
    sub: 'Satyr Kitchen is the production workspace inside Satyr. It turns orders and preorders into production runs, and it shows one run in three views.',
    items: {
      workflow: {
        title: 'Workflow canvas',
        coverLabel: 'Workflow',
        copy: 'Draw each recipe as steps: mix, rest, fill, bake, cool and pack. Each step names its equipment and its time.',
      },
      timeline: {
        title: 'Resource timeline',
        coverLabel: 'Timeline',
        copy: 'See which oven, mixer and person each run uses, hour by hour, and find clashes before the shift starts.',
      },
      floor: {
        title: '3D bakery',
        coverLabel: '3D view',
        copy: 'Watch the run move through a 3D model of your kitchen before you bake it for real.',
      },
    },
  },
  walletBand: {
    title: 'Also from Seams: Seams Wallet',
    sub: 'A stablecoin wallet that opens with a passkey. Keys are split between the device and the server, so neither side can sign alone.',
  },
  cta: {
    home: {
      title: 'Put agents to work in your café',
      sub: 'We connect the shop, Slack and your mailbox with you, and we set the first approval rules together.',
      secondary: 'Explore Satyr',
    },
    ecommerce: {
      title: 'See Satyr run your shop',
      sub: 'Tell us what you sell and where. We show you Satyr on your own shop.',
      secondary: 'See the integrations',
    },
  },
  faq: {
    title: 'FAQs',
    groups: {
      product: 'Product',
      agents: 'Agents',
      control: 'Control',
      start: 'Getting started',
    },
    items: {
      whatIsSatyr: {
        q: 'What is Satyr?',
        a: 'Satyr is an ecommerce suite for cafés and pâtisseries. Agents run the online shop, menus, orders, payments, the inbox and the bake plan, and they work with your team in Slack and in the Portal.',
        more: 'Explore Satyr',
      },
      agents: {
        q: 'What can the agents do?',
        a: 'They draft and publish menus and product descriptions, answer customer and supplier mail with drafts that cite their sources, report failed payments and late orders, and turn orders into a bake plan. They act only through the access that you give them.',
        more: 'Agent workflows',
      },
      control: {
        q: 'How do I stay in control?',
        a: 'Agents prepare changes, and an owner or admin approves them from a Slack card or in the Portal. A change that moves money is approved only in the Portal. Every action leaves a receipt.',
        more: 'Approvals and receipts',
      },
      secrets: {
        q: 'Do agents see our passwords and keys?',
        a: 'No. Logins and API keys stay in the Vault: the Satyr Vault or your own 1Password. Agents use them without seeing them, and no key enters a prompt or a transcript.',
        more: '',
      },
      tools: {
        q: 'Which tools does Satyr connect to?',
        a: 'Slack, Gmail, Shopify, Square, Stripe, Google Drive, Dropbox, Notion and Airtable. Card payments go to your own Stripe or Square account.',
        more: 'Integrations',
      },
      models: {
        q: 'Which AI models does Satyr use?',
        a: 'You choose. Sign in with your ChatGPT account, add your own OpenAI API key, or use the models that Satyr provides.',
        more: '',
      },
      start: {
        q: 'How do we get started?',
        a: 'Talk to us. We connect your shop, your Slack workspace and your mailbox with you, and we set the first approval rules together.',
        more: 'Contact us',
      },
    },
  },
  ecommerceHero: {
    title: 'Agents that run your café’s shop, inside your rules',
    sub: 'Satyr connects the online shop, menus, payments, the inbox and the kitchen plan. Agents work with your team in Slack and in the Portal. Each change that matters waits for your approval, and every action leaves a receipt.',
    secondary: 'See the suite',
    scenes: 'Product scenes',
    previous: 'Previous product scene',
    next: 'Next product scene',
    views: {
      portal: {
        label: 'Portal',
        alt: 'The Agents page of the Satyr Portal: the café’s merchant agent has a suggested change for review',
      },
      activity: {
        label: 'Activity',
        alt: 'The Activity timeline of the Satyr Portal: three Cases wait for a person, and a card shows the steps of a refund request',
      },
      inbox: {
        label: 'Inbox',
        alt: 'A reply that an agent drafted for a customer, with Approve and send, Edit and Reject',
      },
      slack: { label: 'Slack', alt: '' },
      kitchen: {
        label: 'Kitchen',
        alt: 'Satyr Kitchen: a 3D view of the bakery with the details of one batch of financiers',
      },
    },
  },
  slackWindow: {
    label: 'Satyr asks for a menu approval in a Slack channel',
    request:
      'Approval needed: the shop agent wants to publish the autumn menu, with 14 items and 3 new prices.',
    rule: 'An owner or admin can approve it on this card. Nothing goes live before that.',
    approved: 'Approved ✓ the menu is live on the storefront',
    brief: 'Morning brief: 1 failed payment and 2 late orders. Each item links to its order.',
  },
  notFound: {
    kicker: 'Error 404',
    title: 'This page does not exist',
    sub: 'The link can be old, or the address can have a typo. Go back to the home page, or open one of the pages below.',
    requested: 'Requested',
    home: 'Go to home',
    popular: 'Popular pages',
    pricing: 'Pricing',
  },
};

export type SiteCopy = typeof en;

const ja: SiteCopy = {
  common: {
    talkToUs: 'ご相談はこちら',
    exploreSatyr: 'Satyrを見る',
    exploreKitchen: 'Satyr Kitchenを見る',
    exploreWallet: 'Seams Walletを見る',
    readDocs: 'ドキュメントを読む',
    products: '製品',
    productViews: '製品の画面',
  },
  homeHero: {
    title: `ECを、${Z}自動操縦で。`,
    titleMuted: `カフェと${Z}パティスリーの${Z}ために。`,
    sub: 'Satyrのエージェントが、ショップ、受信箱、生産計画を運営します。重要な変更は、あなたの承認を待ちます。',
  },
  tour: {
    label: '製品ツアー',
    tabsLabel: '製品',
    views: '製品の画面',
    explore: '{name}を見る',
    features: '{name}の機能',
    tabs: { satyr: 'Satyr Shop', kitchen: 'Satyr Kitchen' },
    items: {
      inbox: {
        title: '返信はあなたの承認待ち',
        body: 'エージェントがお客様への返信を下書きし、根拠を示します。あなたが承認するまで送信しません。',
        alt: 'エージェントがお客様への返信を下書きしたSatyrの受信箱',
      },
      activity: {
        title: '一日のすべてのケース',
        body: '各エージェントの作業と、人の対応を待つケースがわかります。',
        alt: '人の対応を待つ3件のケースを表示したSatyrポータルのアクティビティ',
      },
      orders: {
        title: '対応が必要な注文',
        body: 'エージェントが各注文をあなたのルールで確認します。問題があれば理由と、承認するだけのメールを表示します。',
        alt: '人の対応が必要な2件の注文を表示したSatyrポータルの注文ページ',
      },
      plan: {
        title: '注文から生産計画へ',
        body: 'Satyrがその日の注文を、キッチンのためのバッチ、工程、時刻に変えます。',
        alt: 'Satyr Kitchen：生産タイムラインの上に3Dのベーカリー',
      },
      batch: {
        title: 'バッチごとに、工程ごとに',
        body: 'バッチを開くと、現在の工程、担当のベイカー、完了時刻がわかります。',
        alt: 'Satyr Kitchen：フィナンシェ48個のバッチの詳細',
      },
      floor: {
        title: 'シフトを事前に確認',
        body: 'シフトの前に、朝の流れをフロアプランと3Dのキッチンで再生します。',
        alt: 'Satyr Kitchen：ベーカリーのフロアプランと3Dビュー',
      },
    },
  },
  duo: {
    title: `ショップから${Z}オーブンまで`,
    copy: 'Satyrが販売を担い、Satyr Kitchenが焼くものを計画します。どちらも同じ注文をもとに動きます。',
    satyr:
      'エージェントがオンラインショップ、メニュー、注文、決済、受信箱を運営します。変更はSlackかポータルで、あなたの承認を待ちます。',
    kitchen:
      '注文と予約から生産ランをつくります。各ランを、ワークフロー、オーブンとスタッフのタイムライン、ベーカリーの3Dビューで確認できます。',
  },
  ecosystem: {
    title: `カフェで${Z}使っている${Z}ツールと${Z}つながる`,
    sub: 'Slack、Gmail、Shopify、Square、Stripe、そしてあなたのファイル。接続ごとに権限を分け、いつでも接続を解除できます。',
    fieldLabel: '麦畑の一部の穂に、連携するツールのロゴ：{tools}',
  },
  pillars: {
    title: `ビジネス全体を、${Z}ひとつの${Z}スイートで`,
    sub: 'オンラインショップ、受信箱、キッチンが、同じ注文をもとに動きます。',
    tablist: 'スイートの領域',
    items: {
      shop: {
        label: 'ショップとメニュー',
        lead: 'メニュー、商品、ストアフロント。',
        rest: 'エージェントがあなたと一緒にメニューと商品説明を下書きし、承認するとメニューを公開します。',
        alt: 'Satyrポータルのチェックアウトページ：お客様がカフェのストアフロントで購入する流れ',
      },
      orders: {
        label: '注文と決済',
        lead: '注文、決済、返金、ギフトカード。',
        rest: 'カード決済はあなた自身のStripeまたはSquareのアカウントに入ります。決済の失敗や注文の遅れは、Slackで報告を依頼できます。',
        alt: 'Satyrポータルの注文ページ：ショップのルールで保留中の2件の注文と、順調な注文',
      },
      inbox: {
        label: '受信箱',
        lead: 'お客様と仕入先のメールに対応。',
        rest: '受信箱のエージェントが、使った根拠とともに返信を下書きし、送信者を該当するお客様や仕入先に結びつけます。',
        alt: 'Satyrの受信箱：エージェントが下書きした返信が承認を待っています',
      },
      production: {
        label: '生産',
        lead: 'Satyr Kitchenが注文を生産計画に変えます。',
        rest: 'ひとつの生産ランを、ワークフロー、オーブンとスタッフのタイムライン、ベーカリーの3Dビューで表示します。',
        alt: 'Satyr Kitchen：3バッチのタイムラインの上に、ベーカリーの3Dビュー',
      },
      vault: {
        label: 'Vault',
        lead: 'エージェントが使い、中身は見ないログイン情報とキー。',
        rest: 'Satyr Vault、またはあなたの1Passwordに保管します。',
        alt: 'SatyrポータルのVaultページ：エージェントが使うログイン情報とAPIキー',
      },
    },
  },
  bento: {
    title: `エージェントは、${Z}あなたの${Z}ルールの${Z}中で動く`,
    sub: 'エージェントが作業を準備し、重要な変更は人が承認します。すべての操作に記録が残ります。',
    slack: {
      label: 'Slackスレッドの承認カード',
      title: '承認カード · #cafe-ops',
      change: '秋のメニューを公開',
      changeNote: 'ショップのエージェントが準備 · 14品目',
      needed: '承認が必要',
      who: '承認できる人',
      whoNote: 'オーナーまたは管理者',
      people: '2人',
      approve: '承認',
      decline: '却下',
    },
    money: {
      label: 'ポータルで承認を待つ返金',
      title: '返金 ¥4,200 · 注文 #2377',
      moves: 'お金が動く操作',
      movesNote: 'チャットのカードでは承認できません',
      held: '保留',
      portal: 'ポータルで承認',
      portalNote: 'オーナー',
      waiting: '待機中',
      receipt: '記録',
      receiptNote: 'プロバイダーの確認結果を保存',
      auto: '自動',
    },
    cards: {
      thread: {
        title: 'スレッドの中で承認',
        copy: 'エージェントはショップへの変更をSlackのカードとして投稿します。オーナーまたは管理者がその場で承認すると、エージェントが作業を続けます。',
      },
      money: {
        title: 'お金はポータルからだけ動く',
        copy: 'チャットのカードでは返金や支払いを承認できません。承認はポータルで行い、Satyrはプロバイダーの確認結果を保存します。',
      },
      roles: {
        title: 'ロール',
        copy: 'オーナー、管理者、メンバーごとに、接続したツールへの権限を分けます。',
      },
      receipts: {
        title: '記録',
        copy: '各操作について、依頼した人、変更内容、プロバイダーが確認した結果を記録します。',
      },
      secrets: {
        title: 'シークレットは渡さない',
        copy: 'エージェントはVaultのログイン情報とAPIキーを使いますが、キーがプロンプトや会話記録に入ることはありません。',
      },
    },
  },
  cases: {
    title: `カフェの仕事を、${Z}エージェントの${Z}ワークフローに`,
    sub: 'エージェントがショップと受信箱を見守り、作業を準備し、あなたが設定した上限の中で動きます。',
    items: {
      shop: {
        title: 'オンラインショップを運営',
        coverLabel: 'ショップ',
        copy: 'エージェントがあなたと一緒にメニューと商品説明を下書きし、承認されたメニューをストアフロントに公開します。',
      },
      inbox: {
        title: '受信箱に対応',
        coverLabel: '受信箱',
        copy: '受信箱のエージェントがお客様と仕入先のメールを読み、根拠とともに返信を下書きし、迷惑メールを振り分けます。',
      },
      orders: {
        title: '決済と注文を見守る',
        coverLabel: '注文',
        copy: '決済の失敗や注文の遅れは、Slackで報告を依頼できます。各項目は注文にリンクし、エージェントが代わりに調べます。',
      },
    },
    flow: {
      label: 'ギフトボックスの注文が確認を経て、生産計画と確認メールに進む流れ',
      tag: 'Satyr · ギフトボックスの注文',
      newOrder: '新しい注文',
      giftBoxes: 'ギフトボックス ×12',
      giftNote: '¥64,800 · 土曜 10:30 受け取り',
      new: '新規',
      checks: '確認',
      stock: '土曜日の在庫',
      pickup: '受け取り枠',
      discount: '法人割引 10%',
      pass: 'OK',
      ownerApproval: 'オーナーの承認',
      actions: '操作',
      planned: '生産計画に追加',
      plannedNote: 'Satyr Kitchen · 2トレイ',
      plannedChip: '計画済み',
      email: '確認メール',
      sent: '送信済み',
      receipt: '記録を保存',
      auto: '自動',
    },
  },
  production: {
    title: `Satyr Kitchen：${Z}注文から${Z}オーブンまで`,
    sub: 'Satyr Kitchenは、Satyrの中の生産ワークスペースです。注文と予約から生産ランをつくり、ひとつのランを3つのビューで表示します。',
    items: {
      workflow: {
        title: 'ワークフローキャンバス',
        coverLabel: 'ワークフロー',
        copy: '各レシピを工程として描きます：混ぜる、寝かせる、詰める、焼く、冷ます、包む。各工程に設備と時間を設定します。',
      },
      timeline: {
        title: 'リソースタイムライン',
        coverLabel: 'タイムライン',
        copy: '各ランが使うオーブン、ミキサー、担当者を時間ごとに確認し、シフトの前に重なりを見つけます。',
      },
      floor: {
        title: '3Dベーカリー',
        coverLabel: '3Dビュー',
        copy: '実際に焼く前に、キッチンの3Dモデルでランの動きを確認します。',
      },
    },
  },
  walletBand: {
    title: `Seamsの${Z}もうひとつの${Z}製品：${Z}Seams Wallet`,
    sub: 'パスキーで開くステーブルコインウォレットです。鍵を端末とサーバーに分散するため、どちらか一方だけでは署名できません。',
  },
  cta: {
    home: {
      title: `あなたの${Z}カフェで、${Z}エージェントを${Z}働かせよう`,
      sub: 'ショップ、Slack、メールボックスの接続をご一緒に行い、最初の承認ルールも一緒に設定します。',
      secondary: 'Satyrを見る',
    },
    ecommerce: {
      title: `Satyrが${Z}あなたの${Z}ショップを${Z}運営する${Z}様子を見る`,
      sub: '何を、どこで販売しているかをお聞かせください。あなたのショップでSatyrをご紹介します。',
      secondary: '連携を見る',
    },
  },
  faq: {
    title: 'よくある質問',
    groups: {
      product: '製品',
      agents: 'エージェント',
      control: '管理',
      start: 'はじめ方',
    },
    items: {
      whatIsSatyr: {
        q: 'Satyrとは？',
        a: 'Satyrは、カフェとパティスリーのためのECスイートです。エージェントがオンラインショップ、メニュー、注文、決済、受信箱、生産計画を運営し、Slackとポータルであなたのチームと一緒に働きます。',
        more: 'Satyrを見る',
      },
      agents: {
        q: 'エージェントは何ができますか？',
        a: 'メニューと商品説明の下書きと公開、根拠を示した下書きによるお客様と仕入先のメールへの返信、決済の失敗と注文の遅れの報告、注文から生産計画の作成を行います。エージェントは、あなたが与えた権限の範囲でのみ動きます。',
        more: 'エージェントのワークフロー',
      },
      control: {
        q: '管理はどうやって保てますか？',
        a: 'エージェントが変更を準備し、オーナーまたは管理者がSlackのカードかポータルで承認します。お金が動く変更は、ポータルでのみ承認できます。すべての操作に記録が残ります。',
        more: '承認と記録',
      },
      secrets: {
        q: 'エージェントはパスワードやキーを見ますか？',
        a: 'いいえ。ログイン情報とAPIキーはVault（Satyr Vault、またはあなたの1Password）に保管します。エージェントは中身を見ずに使い、キーがプロンプトや会話記録に入ることはありません。',
        more: '',
      },
      tools: {
        q: 'Satyrはどのツールと連携しますか？',
        a: 'Slack、Gmail、Shopify、Square、Stripe、Google Drive、Dropbox、Notion、Airtableと連携します。カード決済は、あなた自身のStripeまたはSquareのアカウントに入ります。',
        more: '連携',
      },
      models: {
        q: 'SatyrはどのAIモデルを使いますか？',
        a: 'お選びいただけます。ChatGPTアカウントでサインインする、ご自身のOpenAI APIキーを追加する、またはSatyrが提供するモデルを使う、のいずれかです。',
        more: '',
      },
      start: {
        q: 'どうやって始めますか？',
        a: 'まずはご相談ください。ショップ、Slackワークスペース、メールボックスの接続をご一緒に行い、最初の承認ルールも一緒に設定します。',
        more: 'お問い合わせ',
      },
    },
  },
  ecommerceHero: {
    title: `あなたの${Z}ルールの中で、${Z}カフェの${Z}ショップを${Z}運営する${Z}エージェント`,
    sub: 'Satyrは、オンラインショップ、メニュー、決済、受信箱、キッチンの計画をつなぎます。エージェントはSlackとポータルであなたのチームと一緒に働きます。重要な変更はあなたの承認を待ち、すべての操作に記録が残ります。',
    secondary: 'スイートを見る',
    scenes: '製品のシーン',
    previous: '前のシーン',
    next: '次のシーン',
    views: {
      portal: {
        label: 'ポータル',
        alt: 'Satyrポータルのエージェントページ：カフェのマーチャントエージェントが確認用の変更案を出しています',
      },
      activity: {
        label: 'アクティビティ',
        alt: 'Satyrポータルのアクティビティ：3件のケースが人の対応を待ち、カードに返金依頼の工程を表示しています',
      },
      inbox: {
        label: '受信箱',
        alt: 'エージェントがお客様のために下書きした返信と、承認して送信、編集、却下のボタン',
      },
      slack: { label: 'Slack', alt: '' },
      kitchen: {
        label: 'キッチン',
        alt: 'Satyr Kitchen：ベーカリーの3Dビューと、フィナンシェのバッチの詳細',
      },
    },
  },
  slackWindow: {
    label: 'SatyrがSlackチャンネルでメニューの承認を依頼しています',
    request:
      '承認が必要です：ショップのエージェントが、14品目と3つの新価格を含む秋のメニューを公開しようとしています。',
    rule: 'オーナーまたは管理者がこのカードで承認できます。承認されるまで公開されません。',
    approved: '承認しました ✓ メニューはストアフロントで公開中です',
    brief: '朝の報告：決済の失敗が1件、注文の遅れが2件。各項目は注文にリンクしています。',
  },
  notFound: {
    kicker: 'エラー 404',
    title: `このページは${Z}存在しません`,
    sub: 'リンクが古いか、アドレスに誤りがある可能性があります。ホームに戻るか、下のページを開いてください。',
    requested: 'リクエストされたパス',
    home: 'ホームへ',
    popular: 'よく見られるページ',
    pricing: '料金',
  },
};

export const siteCopy: Record<Locale, SiteCopy> = { en, ja };

/* Fills {name} style placeholders. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
