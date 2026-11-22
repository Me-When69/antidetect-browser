export const vi = {
  app: {
    name: 'Antidetect',
    tagline: 'Quản lý hồ sơ trình duyệt cô lập',
    localMode: 'Cục bộ',
  },
  nav: {
    newProfile: 'Hồ sơ mới',
    sectionProfiles: 'HỒ SƠ',
    allProfiles: 'Tất cả hồ sơ',
    folders: 'Thư mục',
    sectionNetwork: 'MẠNG & HỆ THỐNG',
    proxies: 'Proxy',
    settings: 'Cài đặt',
  },
  topbar: {
    searchPlaceholder: 'Tìm kiếm hồ sơ, thẻ, proxy...',
    shortcut: 'Ctrl K',
  },
  pages: {
    allProfiles: {
      title: 'Tất cả hồ sơ',
      description: 'Quản lý và khởi chạy các hồ sơ trình duyệt cô lập trên máy của bạn.',
      emptyTitle: 'Chưa có hồ sơ nào',
      emptyDescription:
        'Danh sách hồ sơ và cơ sở dữ liệu SQLite sẽ được xây dựng ở Bước 1 theo kế hoạch.',
    },
    folders: {
      title: 'Thư mục',
      description: 'Phân nhóm hồ sơ theo dự án, khách hàng hoặc tài khoản.',
      emptyTitle: 'Chưa có thư mục nào',
      emptyDescription: 'Tính năng quản lý thư mục và lọc hồ sơ sẽ được thêm ở Bước 1.',
    },
    proxies: {
      title: 'Proxy',
      description: 'Quản lý kho HTTP, HTTPS, SOCKS5 proxy và kiểm tra IP đầu ra.',
      emptyTitle: 'Chưa có proxy nào',
      emptyDescription: 'Kho proxy và tính năng kiểm tra IP sẽ được hoàn thiện ở Bước 4.',
    },
    settings: {
      title: 'Cài đặt',
      description: 'Thiết lập ứng dụng, đường dẫn trình duyệt, ngôn ngữ và Local API.',
      emptyTitle: 'Cài đặt hệ thống',
      emptyDescription: 'Các tùy chọn nâng cao sẽ được bổ sung dần theo từng bước.',
    },
    newProfile: {
      title: 'Hồ sơ mới',
      description: 'Tạo cấu hình danh tính, môi trường, proxy và dấu vân tay trình duyệt.',
      emptyTitle: 'Biểu mẫu tạo hồ sơ',
      emptyDescription: 'Form tạo hồ sơ chi tiết theo bố cục chuẩn sẽ được xây dựng ở Bước 2.',
    },
  },
  status: {
    ready: 'Sẵn sàng',
    version: 'Phiên bản',
    electron: 'Electron',
    webPreview: 'Chế độ trình duyệt',
  },
} as const;

export type TranslationDictionary = typeof vi;
