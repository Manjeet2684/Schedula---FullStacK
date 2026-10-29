import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('specializations') specializations() { return this.catalog.listSpecializations(); }
  @Get('doctors') doctors(@Query('search') search?: string, @Query('specializationId') specializationId?: string) { return this.catalog.listDoctors({ search, specializationId }); }
  @Get('doctors/:id') doctor(@Param('id') id: string) { return this.catalog.getDoctor(id); }
  @Get('doctors/:id/availability') availability(@Param('id') id: string, @Query('date') date: string) { return this.catalog.getAvailability(id, date); }
}
