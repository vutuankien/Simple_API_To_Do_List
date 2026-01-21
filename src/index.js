const express = require('express');
const app = express();
const port = 3000
const supabase = require('./config');
const morgan = require('morgan');
const cors = require('cors');

/** Middleware để log các request */
app.use(morgan('dev'));

/** Middleware để parse JSON body */
app.use(express.json());

/** Middleware để parse URL-encoded body */
app.use(express.urlencoded({ extended: true }));

/** Cấu hình CORS với các tùy chọn bảo mật */
const CORS_OPTIONS = {
    /** Danh sách các origin được phép truy cập API */
    origin: [
        'http://localhost:3000',
        'http://localhost:3001', 
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:8080'
    ],
    /** Các HTTP methods được phép */
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
    /** Các headers được phép trong request */
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    /** Cho phép gửi credentials (cookies, authorization headers) */
    credentials: true,
    /** Thời gian cache preflight request (24 giờ) */
    maxAge: 86400
};

/** Áp dụng CORS middleware */
app.use(cors(CORS_OPTIONS));


// Log tất cả các route khi server khởi động

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});


/**
 * POST /create
 * Body Parameters:
 * - title: string
 * - author: string
 * - priority: string
 * - description: string
 * - due_date: string (ISO format)
 * - start_date: string (ISO format)
 * Response: data: created task object
 * Create a new task in the database.
 */
app.post('/tasks', async (req, res) => {
    try {
        const { title, author, priority, description, due_date, start_date } = req.body;

        // Validation
        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Title is required' });
        }

        if (!author || !author.trim()) {
            return res.status(400).json({ error: 'Author is required' });
        }

        // Validate priority (if it has specific values)
        const validPriorities = ['low', 'medium', 'high'];
        if (priority && !validPriorities.includes(priority.toLowerCase())) {
            return res.status(400).json({
                error: `Priority must be one of: ${validPriorities.join(', ')}`
            });
        }

        // Validate dates
        if (due_date && isNaN(Date.parse(due_date))) {
            return res.status(400).json({ error: 'Invalid due_date format' });
        }

        if (start_date && isNaN(Date.parse(start_date))) {
            return res.status(400).json({ error: 'Invalid start_date format' });
        }

        // Check if start_date is before due_date
        if (start_date && due_date && new Date(start_date) > new Date(due_date)) {
            return res.status(400).json({
                error: 'Start date cannot be after due date'
            });
        }

        // Prepare model (only include defined fields)
        const model = {
            title: title.trim(),
            author: author.trim(),
            ...(priority && { priority: priority.toLowerCase() }),
            ...(description && { description: description.trim() }),
            ...(due_date && { due_date }),
            ...(start_date && { start_date })
        };

        const { data, error } = await supabase
            .from('Tasks')
            .insert([model])
            .select(); // Return the inserted data

        if (error) {
            console.error('Database error:', error);

            // Handle specific database errors
            if (error.code === '23505') { // Unique constraint violation
                return res.status(409).json({ error: 'Task already exists' });
            }

            return res.status(500).json({
                error: 'Failed to create task',
                message: error.message
            });
        }

        res.status(201).json({
            message: 'Task created successfully',
            data: data[0]
        });

    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


/**
 * GET /tasks/:id
 * Path Parameters:
 * - id: task ID
 * Response: data: task object
 * Return a single task by ID from the database.
 */
app.get('/tasks/search', async (req, res) => {
    try {
        // Lấy các tham số từ query string
        const {
            q,
            fields,
            limit,
            page,
            sort,
            order,
            priority,
            author,
            start_date_from,
            start_date_to,
            due_date_from,
            due_date_to
        } = req.query;

        // Kiểm tra từ khóa tìm kiếm có tồn tại không
        if (!q || !q.trim()) {
            return res.status(400).json({ error: 'Query parameter q is required' });
        }

        const searchTerm = q.trim();

        // Định nghĩa các trường có thể tìm kiếm
        const searchableFields = ['title', 'description', 'author', 'priority'];

        // Phân tích các trường cần tìm kiếm từ tham số hoặc sử dụng tất cả
        const fieldsToSearch = fields
            ? fields.split(',').filter(f => searchableFields.includes(f.trim()))
            : searchableFields;

        // Kiểm tra xem có trường hợp lệ nào để tìm kiếm không
        if (fieldsToSearch.length === 0) {
            return res.status(400).json({
                error: `Invalid fields. Available: ${searchableFields.join(', ')}`
            });
        }

        // Xây dựng điều kiện OR động cho tìm kiếm văn bản
        const orConditions = fieldsToSearch
            .map(field => `${field}.ilike.%${searchTerm}%`)
            .join(',');

        // Xử lý phân trang: giới hạn số lượng và tính toán phạm vi
        const pageLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const pageNumber = Math.max(parseInt(page) || 1, 1);
        const from = (pageNumber - 1) * pageLimit;
        const to = from + pageLimit - 1;

        // Xử lý sắp xếp: xác định trường và thứ tự sắp xếp
        const validSortFields = [...searchableFields, 'created_at', 'updated_at', 'start_date', 'due_date'];
        const sortField = sort && validSortFields.includes(sort) ? sort : 'created_at';
        const sortOrder = order === 'asc';

        // Xây dựng câu truy vấn cơ bản với điều kiện tìm kiếm
        let query = supabase
            .from('Tasks')
            .select('*', { count: 'exact' })
            .or(orConditions);

        // Áp dụng bộ lọc độ ưu tiên nếu có
        if (priority) {
            const priorities = priority.split(',').map(p => p.trim());
            query = query.in('priority', priorities);
        }

        // Áp dụng bộ lọc tác giả nếu có
        if (author) {
            query = query.ilike('author', `%${author.trim()}%`);
        }

        // Áp dụng các bộ lọc khoảng thời gian cho ngày bắt đầu
        if (start_date_from) {
            query = query.gte('start_date', start_date_from);
        }
        if (start_date_to) {
            query = query.lte('start_date', start_date_to);
        }
        
        // Áp dụng các bộ lọc khoảng thời gian cho ngày hết hạn
        if (due_date_from) {
            query = query.gte('due_date', due_date_from);
        }
        if (due_date_to) {
            query = query.lte('due_date', due_date_to);
        }

        // Áp dụng sắp xếp và phân trang vào truy vấn
        query = query
            .order(sortField, { ascending: sortOrder })
            .range(from, to);

        // Thực thi truy vấn và nhận kết quả
        const { data, error, count } = await query;

        // Xử lý lỗi nếu có
        if (error) {
            console.error('Search error:', error);
            return res.status(500).json({
                error: 'Search failed',
                message: error.message
            });
        }

        // Xây dựng đối tượng chứa các bộ lọc đã áp dụng
        const appliedFilters = {};
        if (priority) appliedFilters.priority = priority.split(',');
        if (author) appliedFilters.author = author;
        if (start_date_from || start_date_to) {
            appliedFilters.start_date = { from: start_date_from, to: start_date_to };
        }
        if (due_date_from || due_date_to) {
            appliedFilters.due_date = { from: due_date_from, to: due_date_to };
        }

        // Trả về kết quả tìm kiếm với thông tin chi tiết
        res.status(200).json({
            data,
            search: {
                query: searchTerm,
                fields: fieldsToSearch,
                filters: appliedFilters,
                resultsCount: count
            },
            pagination: {
                page: pageNumber,
                limit: pageLimit,
                total: count,
                totalPages: Math.ceil(count / pageLimit)
            },
            sorting: {
                field: sortField,
                order: order || 'desc'
            }
        });

    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.get('/tasks/sort', async (req, res) => {
    try {
        const {
            sort_by,
            order,
            limit,
            page,
            priority,
            author,
            start_date_from,
            start_date_to,
            due_date_from,
            due_date_to
        } = req.query;

        // Define sortable fields
        const sortableFields = {
            'title': 'title',
            'author': 'author',
            'priority': 'priority',
            'created_at': 'created_at',
            'updated_at': 'updated_at',
            'start_date': 'start_date',
            'due_date': 'due_date',
            'description': 'description'
        };

        // Validate sort field
        const sortField = sort_by && sortableFields[sort_by]
            ? sortableFields[sort_by]
            : 'created_at';

        // Validate sort order
        const sortOrder = order === 'asc' ? true : false; // default descending

        // Pagination
        const pageLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const pageNumber = Math.max(parseInt(page) || 1, 1);
        const from = (pageNumber - 1) * pageLimit;
        const to = from + pageLimit - 1;

        // Build query
        let query = supabase
            .from('Tasks')
            .select('*', { count: 'exact' });

        // Apply filters
        if (priority) {
            const priorities = priority.split(',').map(p => p.trim().toLowerCase());
            query = query.in('priority', priorities);
        }

        if (author) {
            query = query.ilike('author', `%${author.trim()}%`);
        }

        // Date range filters
        if (start_date_from) {
            query = query.gte('start_date', start_date_from);
        }
        if (start_date_to) {
            query = query.lte('start_date', start_date_to);
        }
        if (due_date_from) {
            query = query.gte('due_date', due_date_from);
        }
        if (due_date_to) {
            query = query.lte('due_date', due_date_to);
        }

        // Apply sorting and pagination
        query = query
            .order(sortField, { ascending: sortOrder, nullsFirst: false })
            .range(from, to);

        const { data, error, count } = await query;

        if (error) {
            console.error('Sort error:', error);
            return res.status(500).json({
                error: 'Failed to sort tasks',
                message: error.message
            });
        }

        res.status(200).json({
            data,
            sorting: {
                field: sortField,
                order: sortOrder ? 'asc' : 'desc'
            },
            pagination: {
                page: pageNumber,
                limit: pageLimit,
                total: count,
                totalPages: Math.ceil(count / pageLimit)
            }
        });

    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


/**
 * GET /tasks/:id
 * Path Parameters:
 * - id: task ID
 * Response: data: task object
 * Return a single task by ID from the database.
 */
app.get('/tasks/:id', async (req, res) => {
    const {id} = req.params;
    if(!id){
        return res.status(400).json({error: 'ID is required'});
    }
    const {data,error} = await supabase.from('Tasks').select('*').eq('id',id).single();
    if(error){
        return res.status(500).json({error: error.message});
    }
    res.status(200).json({data});
})

/**
 * GET /tasks
 * Query Parameters:
 * - limit: number of items per page (default: 10, max: 100)
 * - page: page number (default: 1)
 * Response:
 * - data: array of task objects
 * - pagination: { page, limit, total, totalPages }
 * Return a paginated list of tasks from the database.
 */
app.get('/tasks', async (req, res) => {
    // Parse and validate query parameters
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const page = Math.max(parseInt(req.query.page) || 1, 1);

    // Calculate range
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    try {
        // Fetch data with count for pagination metadata
        const { data, error, count } = await supabase
            .from('Tasks')
            .select('*', { count: 'exact' })
            .range(from, to);

        if (error) {
            console.error('Database error:', error);
            return res.status(500).json({
                error: 'Failed to fetch tasks',
                message: error.message
            });
        }

        // Return data with pagination metadata
        res.status(200).json({
            data,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit)
            }
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


/**
 * PATCH /tasks/:id
 * Path Parameters:
 * - id: task ID
 * Body Parameters:
 * - fields to update (title, author, priority, description, due_date, start_date)
 * Response: data: updated task object
 * Update a task by ID in the database.
 */
app.patch('/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    if (!id) {
        return res.status(400).json({ error: 'ID is required' });
    }

    const exists = await supabase.from('Tasks').select('id').eq('id', id).single();

    if (exists.error) {
        return res.status(404).json({ error: 'Task not found' });
    }
    const { data, error } = await supabase
        .from('Tasks')
        .update(updates)
        .eq('id', id)
        .select();

    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.status(200).json({ data: data[0] });
})


app.delete('/tasks/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ error: 'ID is required' });
    }

    const exists = await supabase.from('Tasks').select('id').eq('id', id).single();

    if (exists.error) {
        return res.status(404).json({ error: 'Task not found' });
    }
    const { data, error } = await supabase
        .from('Tasks')
        .delete()
        .eq('id', id)
        .select();

    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.status(200).json({ data: data[0] });
});

/**
 * GET /search
 * Tìm kiếm tasks với nhiều bộ lọc và tùy chọn
 * 
 * Query Parameters:
 * - q: từ khóa tìm kiếm (bắt buộc)
 * - fields: các trường cần tìm kiếm, phân tách bằng dấu phẩy (mặc định: tất cả)
 * - limit: số lượng kết quả mỗi trang (mặc định: 20, tối đa: 100)
 * - page: số trang (mặc định: 1)
 * - sort: trường để sắp xếp (mặc định: created_at)
 * - order: thứ tự sắp xếp 'asc' hoặc 'desc' (mặc định: desc)
 * - priority: lọc theo độ ưu tiên, phân tách bằng dấu phẩy
 * - author: lọc theo tác giả
 * - start_date_from: lọc ngày bắt đầu từ
 * - start_date_to: lọc ngày bắt đầu đến
 * - due_date_from: lọc ngày hết hạn từ
 * - due_date_to: lọc ngày hết hạn đến
 * 
 * Response:
 * - data: mảng các task tìm được
 * - search: thông tin tìm kiếm (query, fields, filters, resultsCount)
 * - pagination: thông tin phân trang
 * - sorting: thông tin sắp xếp
 */
app.get('/tasks/search', async (req, res) => {
    try {
        // Lấy các tham số từ query string
        const {
            q,
            fields,
            limit,
            page,
            sort,
            order,
            priority,
            author,
            start_date_from,
            start_date_to,
            due_date_from,
            due_date_to
        } = req.query;

        // Kiểm tra từ khóa tìm kiếm có tồn tại không
        if (!q || !q.trim()) {
            return res.status(400).json({ error: 'Query parameter q is required' });
        }

        const searchTerm = q.trim();

        // Định nghĩa các trường có thể tìm kiếm
        const searchableFields = ['title', 'description', 'author', 'priority'];

        // Phân tích các trường cần tìm kiếm từ tham số hoặc sử dụng tất cả
        const fieldsToSearch = fields
            ? fields.split(',').filter(f => searchableFields.includes(f.trim()))
            : searchableFields;

        // Kiểm tra xem có trường hợp lệ nào để tìm kiếm không
        if (fieldsToSearch.length === 0) {
            return res.status(400).json({
                error: `Invalid fields. Available: ${searchableFields.join(', ')}`
            });
        }

        // Xây dựng điều kiện OR động cho tìm kiếm văn bản
        const orConditions = fieldsToSearch
            .map(field => `${field}.ilike.%${searchTerm}%`)
            .join(',');

        // Xử lý phân trang: giới hạn số lượng và tính toán phạm vi
        const pageLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const pageNumber = Math.max(parseInt(page) || 1, 1);
        const from = (pageNumber - 1) * pageLimit;
        const to = from + pageLimit - 1;

        // Xử lý sắp xếp: xác định trường và thứ tự sắp xếp
        const validSortFields = [...searchableFields, 'created_at', 'updated_at', 'start_date', 'due_date'];
        const sortField = sort && validSortFields.includes(sort) ? sort : 'created_at';
        const sortOrder = order === 'asc';

        // Xây dựng câu truy vấn cơ bản với điều kiện tìm kiếm
        let query = supabase
            .from('Tasks')
            .select('*', { count: 'exact' })
            .or(orConditions);

        // Áp dụng bộ lọc độ ưu tiên nếu có
        if (priority) {
            const priorities = priority.split(',').map(p => p.trim());
            query = query.in('priority', priorities);
        }

        // Áp dụng bộ lọc tác giả nếu có
        if (author) {
            query = query.ilike('author', `%${author.trim()}%`);
        }

        // Áp dụng các bộ lọc khoảng thời gian cho ngày bắt đầu
        if (start_date_from) {
            query = query.gte('start_date', start_date_from);
        }
        if (start_date_to) {
            query = query.lte('start_date', start_date_to);
        }
        
        // Áp dụng các bộ lọc khoảng thời gian cho ngày hết hạn
        if (due_date_from) {
            query = query.gte('due_date', due_date_from);
        }
        if (due_date_to) {
            query = query.lte('due_date', due_date_to);
        }

        // Áp dụng sắp xếp và phân trang vào truy vấn
        query = query
            .order(sortField, { ascending: sortOrder })
            .range(from, to);

        // Thực thi truy vấn và nhận kết quả
        const { data, error, count } = await query;

        // Xử lý lỗi nếu có
        if (error) {
            console.error('Search error:', error);
            return res.status(500).json({
                error: 'Search failed',
                message: error.message
            });
        }

        // Xây dựng đối tượng chứa các bộ lọc đã áp dụng
        const appliedFilters = {};
        if (priority) appliedFilters.priority = priority.split(',');
        if (author) appliedFilters.author = author;
        if (start_date_from || start_date_to) {
            appliedFilters.start_date = { from: start_date_from, to: start_date_to };
        }
        if (due_date_from || due_date_to) {
            appliedFilters.due_date = { from: due_date_from, to: due_date_to };
        }

        // Trả về kết quả tìm kiếm với thông tin chi tiết
        res.status(200).json({
            data,
            search: {
                query: searchTerm,
                fields: fieldsToSearch,
                filters: appliedFilters,
                resultsCount: count
            },
            pagination: {
                page: pageNumber,
                limit: pageLimit,
                total: count,
                totalPages: Math.ceil(count / pageLimit)
            },
            sorting: {
                field: sortField,
                order: order || 'desc'
            }
        });

    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.get('/tasks/sort', async (req, res) => {
    try {
        const {
            sort_by,
            order,
            limit,
            page,
            priority,
            author,
            start_date_from,
            start_date_to,
            due_date_from,
            due_date_to
        } = req.query;

        // Define sortable fields
        const sortableFields = {
            'title': 'title',
            'author': 'author',
            'priority': 'priority',
            'created_at': 'created_at',
            'updated_at': 'updated_at',
            'start_date': 'start_date',
            'due_date': 'due_date',
            'description': 'description'
        };

        // Validate sort field
        const sortField = sort_by && sortableFields[sort_by]
            ? sortableFields[sort_by]
            : 'created_at';

        // Validate sort order
        const sortOrder = order === 'asc' ? true : false; // default descending

        // Pagination
        const pageLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const pageNumber = Math.max(parseInt(page) || 1, 1);
        const from = (pageNumber - 1) * pageLimit;
        const to = from + pageLimit - 1;

        // Build query
        let query = supabase
            .from('Tasks')
            .select('*', { count: 'exact' });

        // Apply filters
        if (priority) {
            const priorities = priority.split(',').map(p => p.trim().toLowerCase());
            query = query.in('priority', priorities);
        }

        if (author) {
            query = query.ilike('author', `%${author.trim()}%`);
        }

        // Date range filters
        if (start_date_from) {
            query = query.gte('start_date', start_date_from);
        }
        if (start_date_to) {
            query = query.lte('start_date', start_date_to);
        }
        if (due_date_from) {
            query = query.gte('due_date', due_date_from);
        }
        if (due_date_to) {
            query = query.lte('due_date', due_date_to);
        }

        // Apply sorting and pagination
        query = query
            .order(sortField, { ascending: sortOrder, nullsFirst: false })
            .range(from, to);

        const { data, error, count } = await query;

        if (error) {
            console.error('Sort error:', error);
            return res.status(500).json({
                error: 'Failed to sort tasks',
                message: error.message
            });
        }

        res.status(200).json({
            data,
            sorting: {
                field: sortField,
                order: sortOrder ? 'asc' : 'desc'
            },
            pagination: {
                page: pageNumber,
                limit: pageLimit,
                total: count,
                totalPages: Math.ceil(count / pageLimit)
            }
        });

    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


/**
 * GET /tasks/:id
 * Path Parameters:
 * - id: task ID
 * Response: data: task object
 * Return a single task by ID from the database.
 */
app.get('/tasks/:id', async (req, res) => {
    const {id} = req.params;
    if(!id){
        return res.status(400).json({error: 'ID is required'});
    }
    const {data,error} = await supabase.from('Tasks').select('*').eq('id',id).single();
    if(error){
        return res.status(500).json({error: error.message});
    }
    res.status(200).json({data});
})

/**
 * GET /tasks
 * Query Parameters:
 * - limit: number of items per page (default: 10, max: 100)
 * - page: page number (default: 1)
 * Response:
 * - data: array of task objects
 * - pagination: { page, limit, total, totalPages }
 * Return a paginated list of tasks from the database.
 */
app.get('/tasks', async (req, res) => {
    // Parse and validate query parameters
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const page = Math.max(parseInt(req.query.page) || 1, 1);

    // Calculate range
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    try {
        // Fetch data with count for pagination metadata
        const { data, error, count } = await supabase
            .from('Tasks')
            .select('*', { count: 'exact' })
            .range(from, to);

        if (error) {
            console.error('Database error:', error);
            return res.status(500).json({
                error: 'Failed to fetch tasks',
                message: error.message
            });
        }

        // Return data with pagination metadata
        res.status(200).json({
            data,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit)
            }
        });
    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


/**
 * PATCH /tasks/:id
 * Path Parameters:
 * - id: task ID
 * Body Parameters:
 * - fields to update (title, author, priority, description, due_date, start_date)
 * Response: data: updated task object
 * Update a task by ID in the database.
 */
app.patch('/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    if (!id) {
        return res.status(400).json({ error: 'ID is required' });
    }

    const exists = await supabase.from('Tasks').select('id').eq('id', id).single();

    if (exists.error) {
        return res.status(404).json({ error: 'Task not found' });
    }
    const { data, error } = await supabase
        .from('Tasks')
        .update(updates)
        .eq('id', id)
        .select();

    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.status(200).json({ data: data[0] });
})


app.delete('/tasks/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ error: 'ID is required' });
    }

    const exists = await supabase.from('Tasks').select('id').eq('id', id).single();

    if (exists.error) {
        return res.status(404).json({ error: 'Task not found' });
    }
    const { data, error } = await supabase
        .from('Tasks')
        .delete()
        .eq('id', id)
        .select();

    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.status(200).json({ data: data[0] });
});

app.listen(port, () => {
  console.log(`Example app listening on http://localhost:${port}`);
});