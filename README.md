# Test API

A simple Node.js + Express + Supabase REST API for managing tasks.

## Features
- Create, read, update, delete tasks
- Search and sort tasks with filters
- Pagination support
- Request logging with morgan

## Requirements
- Node.js >= 16
- Supabase project (PostgreSQL)

## Setup
1. Clone the repository:
   ```sh
   git clone <your-repo-url>
   cd Test_api
   ```
2. Install dependencies:
   ```sh
   npm install
   ```
3. Create a `.env` file in the root folder with your Supabase credentials:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
4. Start the server:
   ```sh
   npm start
   ```

## API Endpoints

### Create Task
- **POST** `/tasks`
- Body (JSON):
  - `title` (string, required)
  - `author` (string, required)
  - `priority` (string: low|medium|high)
  - `description` (string)
  - `due_date` (string, ISO format)
  - `start_date` (string, ISO format)

### Get Task By ID
- **GET** `/tasks/:id`

### Get Tasks (Paginated)
- **GET** `/tasks?limit=10&page=1`

### Update Task
- **PATCH** `/tasks/:id`
- Body: fields to update

### Delete Task
- **DELETE** `/tasks/:id`

### Search Tasks
- **GET** `/tasks/search?q=keyword&fields=title,description&limit=10&page=1`
- Query params: `q`, `fields`, `limit`, `page`, `sort`, `order`, `priority`, `author`, `start_date_from`, `start_date_to`, `due_date_from`, `due_date_to`

### Sort Tasks
- **GET** `/tasks/sort?sort_by=priority&order=asc&limit=10&page=1`
- Query params: `sort_by`, `order`, `limit`, `page`, `priority`, `author`, `start_date_from`, `start_date_to`, `due_date_from`, `due_date_to`

## Postman Collection
Import the file `Test_api.postman_collection.json` into Postman to test all endpoints easily.

## License
MIT
